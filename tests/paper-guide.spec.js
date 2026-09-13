import { test, expect } from "@playwright/test";
import { samplePdf } from "./fixtures";
test("paper preparation and stepwise reading quote original pages, cache and reject bad evidence", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    window.__ZHEREADER_BRIDGE__ = {
      base: location.origin,
      token: "a".repeat(64),
    };
    localStorage.setItem("zr-study-model", "test-model");
  });
  let bad = false;
  const calls = [];
  await page.route("**/api/**", async (route) => {
    if (!route.request().url().endsWith("/study")) {
      await route.fulfill({ json: { loggedIn: false } });
      return;
    }
    const input = route.request().postDataJSON();
    calls.push(input);
    const sources = JSON.parse(input.text);
    const source = sources.at(-1);
    await route.fulfill({
      json: {
        title: input.action === "paper-plan" ? "先读什么" : "逐段精读",
        summary: "这是示例文本，非完整论文。",
        prerequisites:
          input.action === "paper-plan"
            ? [
                {
                  topic: "基础术语",
                  why: "理解文本",
                  study: "先读术语定义",
                  checkpoint: "能否解释术语？",
                  sourceId: source.id,
                  quote: source.text,
                },
              ]
            : [],
        explanations: [
          {
            heading: "对照原文",
            kind: "原文解读",
            explanation: "说明当前片段。",
            sourceId: source.id,
            quote: bad ? "This quote was never in the paper." : source.text,
          },
        ],
        questions: ["本段说了什么？"],
        model: "test-model",
      },
    });
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({
    name: "paper.pdf",
    mimeType: "application/pdf",
    buffer: samplePdf(),
  });
  await page.locator(".book-open").click();
  await expect(page.locator("#reader-loading")).toBeHidden();
  await page.locator("#guide-toggle").click();
  await expect(page.locator("#guide-status")).toContainText("正文已就绪");
  expect(calls).toHaveLength(0);
  await page.locator("#guide-background").fill("熟悉编程，想理解方法");
  await page.locator("#guide-plan").click();
  await expect(page.locator("#guide-result")).toContainText("先读什么");
  expect(calls[0].action).toBe("paper-plan");
  expect(calls[0].model).toBe("test-model");
  await page
    .locator("#guide-result")
    .getByRole("button", { name: /原文第 2 页/ })
    .first()
    .click();
  await expect(page.locator("#pdf-text")).toContainText("The second page");
  await page.locator("#guide-next").click();
  await page.locator("#guide-read").click();
  await expect(page.locator("#guide-result")).toContainText("逐段精读");
  expect(JSON.parse(calls[1].text)[0].page).toBe(2);
  await page.locator("#back").click();
  await page.locator(".book-open").click();
  await expect(page.locator("#reader-loading")).toBeHidden();
  await page.locator("#guide-toggle").click();
  await expect(page.locator("#guide-position")).toContainText("2 / 2");
  expect(calls).toHaveLength(2);
  await page.locator("#guide-read").click();
  await expect(page.locator("#guide-status")).toContainText("已加载缓存");
  expect(calls).toHaveLength(2);
  bad = true;
  await page.locator("#guide-regenerate").click();
  await expect(page.locator("#guide-status")).toContainText(
    "引用未能与原文核对",
  );
  await expect(page.locator("#guide-result")).not.toContainText(
    "This quote was never",
  );
  await page.screenshot({
    path: "test-results/paper-guide-desktop.png",
    fullPage: true,
  });
});

test("one-page lookahead is reused, does not run through the whole paper, and settings invalidate cache", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__ZHEREADER_BRIDGE__ = {
      base: location.origin,
      token: "a".repeat(64),
    };
  });
  const calls = [];
  await page.route("**/api/**", async (route) => {
    if (!route.request().url().endsWith("/study")) {
      await route.fulfill({ json: { loggedIn: false } });
      return;
    }
    const input = route.request().postDataJSON();
    calls.push(input);
    const source = JSON.parse(input.text)[0];
    await route.fulfill({
      json: {
        title: "讲解 " + source.id,
        summary: "摘要",
        prerequisites: [],
        explanations: [
          {
            heading: "原文对应",
            kind: "原文解读",
            explanation: "解释",
            sourceId: source.id,
            quote: source.text,
          },
        ],
        questions: ["问题"],
        model: "test",
      },
    });
  });
  await page.goto("/");
  await page
    .locator("#file-input")
    .setInputFiles({
      name: "Prefetch.pdf",
      mimeType: "application/pdf",
      buffer: samplePdf([
        "First page paragraph.",
        "Second page paragraph.",
        "Third page paragraph.",
      ]),
    });
  await page.locator(".book-open").click();
  await expect(page.locator("#reader-loading")).toBeHidden();
  await page.locator("#guide-toggle").click();
  await expect(page.locator("#guide-status")).toContainText("正文已就绪");
  await page.locator("#guide-read").click();
  await expect(page.locator("#guide-prefetch-status")).toContainText(
    "下一段已准备好",
  );
  expect(calls).toHaveLength(2);
  await page.locator("#guide-read").click();
  await expect(page.locator("#guide-status")).toContainText("已加载缓存");
  expect(calls).toHaveLength(2);
  await page.locator("#guide-next").click();
  await expect(page.locator("#guide-result")).toContainText("讲解 p2-s1");
  await expect(page.locator("#guide-prefetch-status")).toContainText(
    "下一段已准备好",
  );
  expect(calls).toHaveLength(3);
  expect(calls.filter((c) => JSON.parse(c.text)[0].page === 2)).toHaveLength(1);
  await page.locator("#guide-prefetch").uncheck();
  await page.locator("#guide-depth").selectOption("detailed");
  await page.locator("#guide-read").click();
  await expect(page.locator("#guide-status")).toContainText("已完成");
  expect(calls).toHaveLength(4);
  expect(calls.at(-1).depth).toBe("detailed");
  await page.locator("#back").click();
  await page.locator(".book-open").click();
  await expect(page.locator("#reader-loading")).toBeHidden();
  await page.locator("#guide-toggle").click();
  await expect(page.locator("#guide-status")).toContainText("已复用缓存");
  await page.locator("#guide-read").click();
  await expect(page.locator("#guide-status")).toContainText("已加载缓存");
  expect(calls).toHaveLength(4);
});
