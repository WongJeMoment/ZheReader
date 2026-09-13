import { test, expect } from "@playwright/test";
import { samplePdf } from "./fixtures";
const root = "/dav/zotero/";
async function mock(page) {
  const calls = [];
  let connected = false;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    window.__ZHEREADER_BRIDGE__ = {
      base: location.origin,
      token: "a".repeat(64),
    };
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const input = route.request().postData()
      ? route.request().postDataJSON()
      : {};
    calls.push({ path, input });
    let body = {};
    if (path === "/api/account") body = { connected: true, loggedIn: false };
    if (path === "/api/cloud/status")
      body = {
        connected,
        directory: "https://dav.jianguoyun.com" + root,
        username: "test@example.com",
      };
    if (path === "/api/cloud/connect" || path === "/api/cloud/list") {
      connected = true;
      body = {
        connected: true,
        directory: input.path || root,
        entries:
          input.path === root + "sub/"
            ? [
                {
                  kind: "file",
                  path: root + "sub/other.pdf",
                  name: "other.pdf",
                  size: 100,
                },
              ]
            : [
                {
                  kind: "archive",
                  path: root + "ABCD1234.zip",
                  name: "ABCD1234.zip",
                  size: 200,
                },
                { kind: "folder", path: root + "sub/", name: "sub" },
              ],
      };
    }
    if (path === "/api/cloud/contents")
      body = { entries: [{ entry: "论文.pdf", name: "论文.pdf", size: 100 }] };
    if (path === "/api/cloud/file") {
      await route.fulfill({
        body: samplePdf(),
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": encodeURIComponent("论文.pdf"),
        },
      });
      return;
    }
    if (path === "/api/cloud/disconnect") {
      connected = false;
      body = { connected: false };
    }
    await route.fulfill({ json: body });
  });
  return calls;
}
async function connect(page) {
  await page.goto("/");
  await page.locator("#cloud-open").click();
  await page.locator("#cloud-username").fill("test@example.com");
  await page.locator("#cloud-password").fill("only-in-memory");
  await page.locator("#cloud-connect").click();
  await expect(page.locator("#cloud-status")).toContainText("连接成功");
}

test("Zotero archive expands to PDF, imports into persistent shelf and duplicates are recognized", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const calls = await mock(page);
  await connect(page);
  await expect(page.locator("#cloud-password")).toHaveValue("");
  await page.getByRole("button", { name: "查看 PDF", exact: true }).click();
  await expect(page.locator(".cloud-file")).toContainText(["sub", "论文.pdf"]);
  await page
    .getByRole("checkbox", { name: "选择 论文.pdf", exact: true })
    .check();
  await page.locator("#cloud-import").click();
  await expect(page.locator("#cloud-status")).toContainText("导入 1 篇");
  await page
    .getByRole("checkbox", { name: "选择 论文.pdf", exact: true })
    .check();
  await page.locator("#cloud-import").click();
  await expect(page.locator("#cloud-status")).toContainText("已在书架中");
  await page.locator("#cloud-close").click();
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page.getByRole("button", { name: "阅读 论文", exact: true }).click();
  await expect(page.locator("#pdf-text")).toContainText("Hello ZheReader");
  expect(calls.find((c) => c.path === "/api/cloud/file").input).toEqual({
    path: root + "ABCD1234.zip",
    entry: "论文.pdf",
  });
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }).includes(
        "only-in-memory",
      ),
    ),
  ).toBe(false);
});
test("folders, search, refresh and key lookup work with batch archive import", async ({
  page,
}) => {
  await mock(page);
  await connect(page);
  await page.getByRole("button", { name: "打开", exact: true }).click();
  await expect(page.locator("#cloud-path")).toHaveText(root + "sub/");
  await page.locator("#cloud-up").click();
  await expect(page.locator("#cloud-path")).toHaveText(root);
  await page.locator("#cloud-search").fill("ABCD");
  await expect(page.locator(".cloud-file")).toHaveCount(1);
  await page.locator("#cloud-select-all").check();
  await page.locator("#cloud-import").click();
  await expect(page.locator("#cloud-status")).toContainText("导入 1 篇");
  await page.locator("#cloud-search").clear();
  await page.locator(".cloud-lookup summary").click();
  await page.locator("#cloud-key").fill("ZZZZ1234");
  await page.locator("#cloud-lookup").click();
  await expect(page.locator("#cloud-status")).toContainText("找到 1");
});
test("connection failures clear password and cancellation stops download before import", async ({
  page,
}) => {
  await mock(page);
  await page.route("**/api/cloud/connect", (route) =>
    route.fulfill({ status: 502, json: { error: "应用密码错误" } }),
  );
  await page.goto("/");
  await page.locator("#cloud-open").click();
  await page.locator("#cloud-username").fill("test@example.com");
  await page.locator("#cloud-password").fill("bad-secret");
  await page.locator("#cloud-connect").click();
  await expect(page.locator("#cloud-status")).toContainText("应用密码错误");
  await expect(page.locator("#cloud-password")).toHaveValue("");
  await expect(page.locator("#cloud-connect")).toBeEnabled();
  await page.unroute("**/api/cloud/connect");
  await page.locator("#cloud-password").fill("valid");
  await page.locator("#cloud-connect").click();
  await expect(page.locator("#cloud-status")).toContainText("连接成功");
  let started = false;
  await page.route("**/api/cloud/file", async (route) => {
    started = true;
    await new Promise((r) => setTimeout(r, 1000));
    await route.fulfill({ body: samplePdf() });
  });
  await page.getByRole("checkbox", { name: "选择 ABCD1234.zip" }).check();
  await page.locator("#cloud-import").click();
  await expect.poll(() => started).toBe(true);
  await page.locator("#cloud-stop").click();
  await expect(page.locator("#cloud-status")).toContainText("已停止");
  await page.locator("#cloud-close").click();
  await expect(page.locator(".book-card")).toHaveCount(0);
});
