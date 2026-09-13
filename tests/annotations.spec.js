import { test, expect } from "@playwright/test";
import { samplePdf } from "./fixtures";
const root = "/dav/zotero/";
async function setup(page) {
  let synced = null,
    conflict = false;
  const writes = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    window.__ZHEREADER_BRIDGE__ = {
      base: location.origin,
      token: "a".repeat(64),
    };
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      input = route.request().postData() ? route.request().postDataJSON() : {};
    let body = {};
    if (path === "/api/account") body = { connected: true, loggedIn: false };
    if (path === "/api/cloud/status")
      body = {
        connected: true,
        directory: "https://dav.jianguoyun.com" + root,
        username: "test@example.com",
      };
    if (path === "/api/cloud/list")
      body = {
        directory: root,
        entries: [
          {
            kind: "archive",
            path: root + "ATTACH23.zip",
            name: "ATTACH23.zip",
            size: 200,
          },
        ],
      };
    if (path === "/api/cloud/contents")
      body = {
        entries: [{ entry: "paper.pdf", name: "paper.pdf", size: 100 }],
      };
    if (path === "/api/cloud/file") {
      await route.fulfill({
        body: samplePdf(),
        headers: { "X-File-Name": "paper.pdf" },
      });
      return;
    }
    if (path === "/api/zotero/pair")
      body = { connected: true, instance: "local-test" };
    if (path === "/api/zotero/catalog")
      body = {
        instance: "local-test",
        collections: [
          { key: "ROOTCOL2", name: "机器学习", parentKey: null },
          { key: "SUBCOL23", name: "语言模型", parentKey: "ROOTCOL2" },
          { key: "OTHER234", name: "待读", parentKey: null },
          { key: "EMPTY234", name: "空分类", parentKey: null },
        ],
        attachments: [
          {
            key: "ATTACH23",
            parentKey: "PARENT23",
            title: "Zotero Paper",
            tags: ["机器学习", "精读"],
            filename: "paper.pdf",
            collections: ["SUBCOL23", "OTHER234"],
          },
        ],
      };
    if (path === "/api/zotero/sync") {
      writes.push(input);
      if (conflict) {
        await route.fulfill({
          status: 409,
          json: { error: "Zotero 标注已修改，未覆盖。" },
        });
        return;
      }
      synced = input.annotation;
      body = input.deleted
        ? { deleted: true, key: input.key }
        : { base: "b".repeat(64), key: input.annotation.key };
    }
    if (path === "/api/zotero/read")
      body = {
        annotation: { ...synced, comment: "Zotero 中的新评论" },
        base: "c".repeat(64),
      };
    await route.fulfill({ json: body });
  });
  return {
    writes,
    setConflict(value) {
      conflict = value;
    },
  };
}
async function importPaper(page) {
  await page.goto("/");
  await page.locator("#cloud-open").click();
  await expect(page.locator("#cloud-files")).toContainText("ATTACH23.zip");
  await page.getByRole("checkbox", { name: "选择 ATTACH23.zip" }).check();
  await page.locator("#cloud-import").click();
  await expect(page.locator("#cloud-status")).toContainText("导入 1 篇");
  await page.locator("#cloud-close").click();
}
async function connectZotero(page) {
  await page.locator("#zotero-open").click();
  await page.locator("#zotero-connect").click();
  await expect(page.locator("#zotero-status")).toContainText("关联 1 篇");
  await page.locator("#zotero-close").click();
}
async function selectText(page) {
  await page
    .locator("#pdf-text span")
    .first()
    .evaluate((span) => {
      const range = document.createRange();
      range.setStart(span.firstChild, 0);
      range.setEnd(span.firstChild, 5);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      document.dispatchEvent(new Event("pointerup"));
    });
  await page.locator("#annotate-selection").click();
}

test("imported paper adopts nested and multiple Zotero collections, including after reload", async ({
  page,
}) => {
  await setup(page);
  await importPaper(page);
  await connectZotero(page);
  await expect(page.locator(".book-card")).toContainText("Zotero Paper");
  await expect(page.locator(".book-collections")).toContainText(
    "机器学习 / 语言模型",
  );
  for (const key of ["ROOTCOL2", "SUBCOL23", "OTHER234"]) {
    await page.locator(`[data-collection="${key}"]`).click();
    await expect(page.locator(".book-card")).toHaveCount(1);
  }
  await page.locator('[data-collection="EMPTY234"]').click();
  await expect(page.locator(".book-card")).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-collection="SUBCOL23"]')).toBeVisible();
  await expect(page.locator(".book-card")).toContainText("Zotero Paper");
});
test("PDF selection saves native coordinates, persists highlights and pushes edits with conflict recovery", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const state = await setup(page);
  await importPaper(page);
  await connectZotero(page);
  await page
    .getByRole("button", { name: "阅读 Zotero Paper", exact: true })
    .click();
  await expect(page.locator("#reader-loading")).toBeHidden();
  await selectText(page);
  await page.locator("#annotation-comment").fill("我的理解");
  await page.locator("#annotation-save").click();
  await expect(page.locator(".annotation-card")).toContainText("我的理解");
  await expect(page.locator(".pdf-highlight")).toHaveCount(1);
  await expect(page.locator(".pdf-highlight")).toHaveCSS(
    "background-color",
    "rgb(255, 212, 0)",
  );
  await page.locator("#annotation-sync").click();
  await expect(page.locator("#annotation-status")).toContainText("已同步 1 条");
  expect(state.writes[0].annotation.text).toBe("Hello");
  expect(state.writes[0].annotation.position.pageIndex).toBe(0);
  const rect = state.writes[0].annotation.position.rects[0];
  expect(rect[0]).toBeCloseTo(40, 0);
  expect(rect[1]).toBeGreaterThan(380);
  expect(rect[2]).toBeGreaterThan(rect[0]);
  expect(state.writes[0].attachmentKey).toBe("ATTACH23");
  expect(state.writes[0].fileHash).toMatch(/^[a-f0-9]{64}$/);
  await page
    .locator(".annotation-card")
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await page.locator("#annotation-type").selectOption("underline");
  await page.locator("#annotation-comment").fill("本地修改");
  await page.locator("#annotation-save").click();
  state.setConflict(true);
  await page.locator("#annotation-sync").click();
  await expect(page.locator(".annotation-card")).toContainText("未覆盖");
  await page.getByRole("button", { name: "采用 Zotero 版本" }).click();
  await expect(page.locator(".annotation-card")).toContainText(
    "Zotero 中的新评论",
  );
  await page.locator("#back").click();
  await page.reload();
  await page.getByRole("button", { name: "继续阅读" }).click();
  await expect(page.locator(".pdf-highlight")).toHaveCount(1);
  await page.locator("#annotation-toggle").click();
  await expect(page.locator(".annotation-card")).toContainText(
    "Zotero 中的新评论",
  );
  await page.screenshot({ path: "test-results/annotations-desktop.png" });
  expect(errors).toEqual([]);
});
test("synced annotation deletion is queued and retry retains its identity", async ({
  page,
}) => {
  const state = await setup(page);
  await importPaper(page);
  await connectZotero(page);
  await page
    .getByRole("button", { name: "阅读 Zotero Paper", exact: true })
    .click();
  await expect(page.locator("#reader-loading")).toBeHidden();
  await selectText(page);
  await page.locator("#annotation-save").click();
  await page.locator("#annotation-sync").click();
  await expect(page.locator("#annotation-status")).toContainText("已同步 1 条");
  const key = state.writes[0].annotation.key;
  await page
    .locator(".annotation-card")
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await expect(page.locator(".annotation-card")).toContainText("待同步删除");
  await expect(page.locator(".pdf-highlight")).toHaveCount(0);
  await page.locator("#annotation-sync").click();
  await expect(page.locator(".annotation-card")).toHaveCount(0);
  expect(state.writes[1].key).toBe(key);
  expect(state.writes[1].deleted).toBe(true);
  expect(state.writes[1].base).toBe("b".repeat(64));
});

test("existing version-one shelf survives annotation storage upgrade", async ({
  page,
}) => {
  await page.route("**/seed", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html></html>" }),
  );
  await page.goto("/seed");
  await page.evaluate(async (bytes) => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("zhereader", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("books", { keyPath: "id" });
        req.result.createObjectStore("files");
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result,
          tx = db.transaction(["books", "files"], "readwrite");
        tx.objectStore("books").put({
          id: "a".repeat(64),
          type: "pdf",
          title: "Legacy paper",
          filename: "old.pdf",
          pages: 2,
          position: 1,
          color: 0,
          bookmarks: [],
        });
        tx.objectStore("files").put(
          new Uint8Array(bytes).buffer,
          "a".repeat(64),
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
  }, Array.from(samplePdf()));
  await page.goto("/");
  await expect(page.locator(".book-card")).toContainText("Legacy paper");
  await page
    .getByRole("button", { name: "阅读 Legacy paper", exact: true })
    .click();
  await expect(page.locator("#reader-loading")).toBeHidden();
  await selectText(page);
  await page.locator("#annotation-save").click();
  await expect(page.locator(".annotation-card")).toContainText("Hello");
  await expect(page.locator(".pdf-highlight")).toHaveCSS(
    "background-color",
    "rgb(255, 212, 0)",
  );
});

test("tag search uses Zotero tags and local tags survive refresh and reload", async ({
  page,
}) => {
  await setup(page);
  await importPaper(page);
  await connectZotero(page);
  await page.locator("#search").fill("精读");
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page.locator("#search").fill("Zotero Paper");
  await expect(page.locator(".book-card")).toHaveCount(0);
  await page.locator("#search").fill("");
  await page.locator("[data-tags]").click();
  await page.locator("#local-tags").fill("待读，<b>测试</b>，待读");
  await page.getByRole("button", { name: "保存标签", exact: true }).click();
  await page
    .locator("#tag-filter")
    .getByRole("button", { name: "待读 · 1", exact: true })
    .click();
  await expect(page.locator(".book-card")).toHaveCount(1);
  await expect(
    page.locator(".book-tag").filter({ hasText: "<b>测试</b>" }),
  ).toHaveText("<b>测试</b>");
  await page
    .locator("#tag-filter")
    .getByRole("button", { name: "未添加标签 · 0", exact: true })
    .click();
  await expect(page.locator(".book-card")).toHaveCount(0);
  await page.reload();
  await page.locator("#search").fill("待读");
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page.locator("#zotero-open").click();
  await page.locator("#zotero-refresh").click();
  await expect(page.locator("#zotero-status")).toContainText("已读取");
  await page.locator("#zotero-close").click();
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page.screenshot({
    path: "test-results/tags-desktop.png",
    fullPage: true,
  });
});
