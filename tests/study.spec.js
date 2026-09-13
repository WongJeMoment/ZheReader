import { test, expect } from "@playwright/test";
import { samplePdf } from "./fixtures";
const result = {
  title: "句子分析",
  translation: "你好，ZheReader。",
  summary: "这是一个问候语。",
  grammar: [{ part: "称呼", text: "ZheReader", explanation: "称呼读者。" }],
  vocabulary: [{ term: "Hello", meaning: "你好", example: "Hello, friend." }],
  sources: [{ title: "参考词典", url: "https://example.com/dictionary" }],
  searchQueries: ["hello meaning"],
  model: "test-model",
  searched: false,
};
async function setup(page, { loggedIn = true, delay = 0 } = {}) {
  const calls = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    window.__ZHEREADER_BRIDGE__ = {
      base: location.origin,
      token: "a".repeat(64),
    };
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = {};
    if (path.endsWith("/account"))
      body = {
        connected: true,
        loggedIn,
        email: "reader@example.com",
        plan: "plus",
      };
    if (path.endsWith("/models"))
      body = {
        models: [{ id: "test-model", name: "Test GPT", isDefault: true }],
      };
    if (path.endsWith("/limits"))
      body = { rateLimits: { primary: { usedPercent: 12 } } };
    if (path.endsWith("/study")) {
      const input = route.request().postDataJSON();
      calls.push(input);
      if (delay && calls.length === 1)
        await new Promise((r) => setTimeout(r, delay));
      body = {
        ...result,
        translation: input.text.startsWith("Hello")
          ? result.translation
          : "新选区译文",
        searched: input.action === "research",
      };
    }
    await route.fulfill({ json: body });
  });
  return calls;
}
async function openPdf(page) {
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({
    name: "Study.pdf",
    mimeType: "application/pdf",
    buffer: samplePdf(),
  });
  await page.getByRole("button", { name: "阅读 Study", exact: true }).click();
  await expect(page.locator("#reader-loading")).toBeHidden();
}
async function select(locator, start = 0, end) {
  await locator.evaluate(
    (el, { start, end }) => {
      const doc = el.ownerDocument;
      const range = doc.createRange();
      range.setStart(el.firstChild, start);
      range.setEnd(el.firstChild, end ?? el.firstChild.textContent.length);
      doc.getSelection().removeAllRanges();
      doc.getSelection().addRange(range);
      doc.dispatchEvent(new Event("pointerup"));
    },
    { start, end },
  );
}

test("PDF selection translates, then right sidebar analyzes, explains and researches with follow-ups", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const calls = await setup(page);
  await openPdf(page);
  await select(page.locator("#pdf-text span").first());
  await expect(page.locator("#translation-result")).toHaveText(
    result.translation,
  );
  expect(calls[0]).toEqual({
    action: "translate",
    text: "Hello ZheReader",
    model: "",
  });
  await page.locator('[data-study-action="analyze"]').click();
  await expect(page.locator("#study-panel")).toBeVisible();
  await expect(page.locator(".grammar-part")).toContainText("称呼读者");
  await page.locator('[data-study-tab="explain"]').click();
  await expect(page.locator("#study-status")).toContainText("已完成");
  await page.locator('[data-study-tab="research"]').click();
  await expect(page.locator(".study-search-status")).toContainText(
    "已进行联网检索",
  );
  await expect(page.locator(".study-sources a")).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  await page.locator("#study-question").fill("为什么这么用？");
  await page.getByRole("button", { name: "发送追问" }).click();
  await expect.poll(() => calls.at(-1)?.question).toBe("为什么这么用？");
  expect(calls.at(-1).action).toBe("research");
  await expect(page.locator("#study-status")).toContainText("已完成");
  await page.screenshot({ path: "test-results/study-desktop.png" });
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#study-panel")).toBeHidden();
  expect(errors).toEqual([]);
});
test("EPUB selection crosses iframe into translation and stale requests never replace a new selection", async ({
  page,
}) => {
  const calls = await setup(page, { delay: 1400 });
  await page.goto("/");
  await page.getByRole("button", { name: "探索阅读体验" }).click();
  await expect(page.locator("#reader-loading")).toBeHidden();
  const paragraph = page
    .frameLocator("#epub-container iframe")
    .locator("p")
    .first();
  await select(paragraph, 0, 9);
  await expect.poll(() => calls.length).toBe(1);
  await select(paragraph, 2, 12);
  await expect(page.locator("#translation-result")).toHaveText("新选区译文");
  expect(calls[1].text.length).toBe(10);
  await expect(page.locator("#translation-original")).toHaveText(calls[1].text);
  await page.locator('[data-study-action="analyze"]').click();
  await expect(page.locator("#study-original")).toHaveText(calls[1].text);
});
test("unlogged account shows actionable login and never sends selection", async ({
  page,
}) => {
  const calls = await setup(page, { loggedIn: false });
  await openPdf(page);
  await select(page.locator("#pdf-text span").first());
  await expect(page.locator("#translation-result")).toContainText(
    "登录 ChatGPT",
  );
  expect(calls).toHaveLength(0);
  await expect(page.locator('[data-study-action="analyze"]')).toBeDisabled();
  await page.locator("#translation-account").click();
  await expect(page.locator("#account-login")).toBeEnabled();
  await expect(page.locator("#account-status")).toContainText("请登录");
});
test("automatic translation can be disabled and model text is rendered safely", async ({
  page,
}) => {
  const calls = await setup(page);
  await openPdf(page);
  await page.locator("#reader-view .account-open").click();
  await page.locator("#study-auto").uncheck();
  await page.locator("#account-close").click();
  await select(page.locator("#pdf-text span").first());
  await expect(page.locator("#translation-result")).toContainText(
    "已关闭自动翻译",
  );
  expect(calls).toHaveLength(0);
  await page.locator("#translation-retry").click();
  await expect(page.locator("#translation-result")).toHaveText(
    result.translation,
  );
  await page.route("**/api/study", (route) =>
    route.fulfill({
      json: {
        ...result,
        summary: "<img src=x onerror=alert(1)>",
        grammar: [
          { part: "<script>", text: "<img>", explanation: "<b>text</b>" },
        ],
        sources: [{ title: "unsafe", url: "javascript:alert(1)" }],
      },
    }),
  );
  await page.locator('[data-study-action="analyze"]').click();
  await expect(page.locator(".study-summary")).toHaveText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator("#study-content img")).toHaveCount(0);
  await expect(page.locator(".study-sources a")).toHaveCount(0);
});

test("expanded model picker searches hidden models, preserves selection on failure and passes custom IDs", async ({
  page,
}) => {
  const calls = await setup(page);
  await page.route("**/api/models", (route) =>
    route.fulfill({
      json: {
        models: [
          {
            id: "test-model",
            name: "Test GPT",
            isDefault: true,
            hidden: false,
          },
          {
            id: "extra-model",
            name: "Extra GPT",
            hidden: true,
            description: "Additional model",
          },
        ],
      },
    }),
  );
  await openPdf(page);
  await page.locator("#reader-view .account-open").click();
  await expect(page.locator("#study-model-status")).toContainText(
    "共 2 个模型",
  );
  await expect(
    page.locator('#study-model optgroup[label="更多模型 · 默认隐藏"] option'),
  ).toHaveCount(1);
  await page.locator("#study-model-search").fill("extra");
  await expect(
    page.locator('#study-model option[value="test-model"]'),
  ).toHaveCount(0);
  await page.locator("#study-model").selectOption("extra-model");
  await expect(page.locator("#study-model-note")).toContainText("用途有限");
  await page.route("**/api/models", (route) =>
    route.fulfill({ status: 502, json: { error: "测试连接失败" } }),
  );
  await page.locator("#study-model-refresh").click();
  await expect(page.locator("#study-model-status")).toContainText(
    "已保留当前选择",
  );
  await expect(page.locator("#study-model")).toHaveValue("extra-model");
  await page.locator(".model-custom summary").click();
  await page.locator("#study-model-custom").fill("custom-model");
  await page.locator("#study-model-apply").click();
  await expect(page.locator("#study-model")).toHaveValue("custom-model");
  await page.locator("#account-close").click();
  await select(page.locator("#pdf-text span").first());
  await expect.poll(() => calls.at(-1)?.model).toBe("custom-model");
  await page.reload();
  await page.locator(".account-open").first().click();
  await expect(page.locator("#study-model")).toHaveValue("custom-model");
});

test("translation, analysis and research run independently and tab switches retain results", async ({
  page,
}) => {
  await setup(page);
  let releaseTranslation, releaseAnalysis;
  const translationGate = new Promise((r) => (releaseTranslation = r)),
    analysisGate = new Promise((r) => (releaseAnalysis = r));
  const requests = [];
  await page.route("**/api/study", async (route) => {
    const input = route.request().postDataJSON();
    requests.push(input.action);
    if (input.action === "translate") await translationGate;
    if (input.action === "analyze") await analysisGate;
    await route.fulfill({
      json: { ...result, searched: input.action === "research" },
    });
  });
  await openPdf(page);
  await select(page.locator("#pdf-text span").first());
  await expect.poll(() => requests).toContain("translate");
  await page.locator('[data-study-action="analyze"]').click();
  await expect.poll(() => requests).toContain("analyze");
  await page.locator('[data-study-tab="research"]').click();
  await expect(page.locator(".study-search-status")).toContainText(
    "已进行联网检索",
  );
  expect(requests).toEqual(["translate", "analyze", "research"]);
  releaseAnalysis();
  releaseTranslation();
  await expect(page.locator("#study-translation")).toHaveText(
    result.translation,
  );
  await expect(page.locator(".study-search-status")).toBeVisible();
  await page.locator('[data-study-tab="analyze"]').click();
  await expect(page.locator(".grammar-part")).toContainText("称呼读者");
  expect(requests.filter((a) => a === "analyze")).toHaveLength(1);
});

test("PDF Ctrl-wheel and keyboard zoom keep the website and sidebars at their original size", async ({
  page,
}) => {
  await setup(page);
  await openPdf(page);
  await select(page.locator("#pdf-text span").first());
  await expect(page.locator("#translation-result")).toHaveText(
    result.translation,
  );
  await page.locator('[data-study-action="analyze"]').click();
  await expect(page.locator("#study-status")).toContainText("已完成");
  const sidebar = await page.locator("#study-panel").boundingBox();
  const before = await page.locator("#pdf-page").boundingBox();
  const header = await page.locator(".reader-header").boundingBox();
  const width = await page.evaluate(() => innerWidth);
  const prevented = await page.locator("#pdf-container").evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const e = new WheelEvent("wheel", {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      clientX: rect.left + 200,
      clientY: rect.top + 200,
    });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(page.locator("#size-label")).toHaveText("110%");
  await expect
    .poll(async () => (await page.locator("#pdf-page").boundingBox()).width)
    .toBeGreaterThan(before.width);
  expect(await page.locator(".reader-header").boundingBox()).toEqual(header);
  expect(await page.locator("#study-panel").boundingBox()).toEqual(sidebar);
  expect(await page.evaluate(() => innerWidth)).toBe(width);
  await page.keyboard.press("Control+=");
  await expect(page.locator("#size-label")).toHaveText("120%");
  await page.keyboard.press("Control+0");
  await expect(page.locator("#size-label")).toHaveText("100%");
  await expect
    .poll(async () => (await page.locator("#pdf-page").boundingBox()).width)
    .toBeCloseTo(before.width, 0);
});
