import { test, expect } from "@playwright/test";
import { themeAt } from "../src/theme";
import { fileURLToPath } from "node:url";
const epubPath = fileURLToPath(
  new URL("../public/sample.epub", import.meta.url),
);
import { samplePdf } from "./fixtures";

test("theme boundaries", () => {
  expect(themeAt(0)).toBe("dark");
  expect(themeAt(6)).toBe("dark");
  expect(themeAt(7)).toBe("light");
  expect(themeAt(19)).toBe("light");
  expect(themeAt(20)).toBe("dark");
  expect(themeAt(23)).toBe("dark");
});
test("automatic theme changes across 20:00 and preference persists", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-09-13T19:59:59+08:00"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.clock.setFixedTime(new Date("2026-09-13T20:00:00+08:00"));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "主题设置" }).first().click();
  await page.locator('[data-theme-mode="light"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
test("EPUB import, contents, bookmark and resume", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.log(m.text());
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles(epubPath);
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "阅读 慢读时光", exact: true })
    .click();
  await expect(page.locator("#reader-loading")).toBeHidden({ timeout: 20000 });
  await expect(page.locator("#epub-container iframe")).toHaveCount(1);
  await page.getByRole("button", { name: "目录与书签", exact: true }).click();
  await page
    .getByRole("button", { name: "第二章 · 在字里行间散步", exact: true })
    .click();
  await expect(page.locator("#epub-position")).toContainText("第二章");
  await page.getByRole("button", { name: "添加书签", exact: true }).click();
  await expect(page.locator("#add-bookmark")).toHaveClass(/bookmarked/);
  await page.locator("#back").click();
  await page.reload();
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page.getByRole("button", { name: "继续阅读" }).click();
  await expect(page.locator("#reader-loading")).toBeHidden();
  await expect(page.locator("#epub-position")).toContainText("第二章");
  await page.getByRole("button", { name: "放大字号或页面" }).click();
  await expect(page.locator("#size-label")).toHaveText("22px");
  await page.locator("#back").click();
  await page.locator("#file-input").setInputFiles(epubPath);
  await expect(page.locator("#toast")).toContainText("已在书架中");
  expect(errors).toEqual([]);
});
test("PDF rendering, text selection layer, pagination, bookmark and persistence", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.log(m.text());
  });
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({
    name: "Test document.pdf",
    mimeType: "application/pdf",
    buffer: samplePdf(),
  });
  await expect(page.locator(".book-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "阅读 Test document", exact: true })
    .click();
  await expect(page.locator("#reader-loading")).toBeHidden({ timeout: 20000 });
  await expect(page.locator("#pdf-text")).toContainText("Hello ZheReader");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#page-number")).toHaveValue("2");
  await expect(page.locator("#pdf-text")).toContainText("The second page");
  await expect(page.locator("#next-page")).toHaveCount(0);
  await page.getByRole("button", { name: "添加书签", exact: true }).click();
  await page.locator("#back").click();
  await page.reload();
  await page.getByRole("button", { name: "继续阅读" }).click();
  await expect(page.locator("#reader-loading")).toBeHidden();
  await expect(page.locator("#page-number")).toHaveValue("2");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#page-number")).toHaveValue("1");
  await page.locator("#back").click();
  await page
    .getByRole("button", { name: "移除 Test document", exact: true })
    .click();
  await page.locator("#confirm-delete").click();
  await expect(page.locator(".book-card")).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("sample opens and desktop layout fits screen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "探索阅读体验" }).click();
  await expect(page.locator("#reader-view")).toBeVisible();
  await expect(page.locator("#reader-loading")).toBeHidden({ timeout: 20000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator("#back").click();
  await page.locator("#search").fill("不存在的书");
  await expect(page.getByText("还没有找到这本书")).toBeVisible();
});
test("invalid import gives recoverable error", async ({ page }) => {
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("invalid document"),
  });
  await expect(page.locator("#toast")).toContainText("文件损坏");
  await expect(page.locator("#import-top")).toBeEnabled();
  await expect(page.locator(".book-card")).toHaveCount(0);
});
test("broken EPUB does not block further imports", async ({ page }) => {
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({
    name: "broken.epub",
    mimeType: "application/epub+zip",
    buffer: Buffer.from("invalid zip"),
  });
  await expect(page.locator("#toast")).toContainText("文件损坏");
  await expect(page.locator("#import-top")).toBeEnabled();
  await page.locator("#file-input").setInputFiles(epubPath);
  await expect(page.locator(".book-card")).toHaveCount(1);
});

test("PDF wheel scrolls through continuous pages, releases distant canvases and restores location", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page
    .locator("#file-input")
    .setInputFiles({
      name: "Continuous.pdf",
      mimeType: "application/pdf",
      buffer: samplePdf(
        Array.from({ length: 10 }, (_, i) => `Continuous page ${i + 1}`),
      ),
    });
  await page.locator(".book-open").click();
  await expect(page.locator("#reader-loading")).toBeHidden();
  await expect(page.locator("[data-pdf-page]")).toHaveCount(10);
  await expect(page.locator("#next-page,#prev-page")).toHaveCount(0);
  const bounds = await page.locator("#pdf-container").boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.wheel(0, 1250);
  await expect(page.locator("#page-number")).toHaveValue("2");
  await expect(page.locator("#pdf-text")).toContainText("Continuous page 2");
  await page.locator("#page-number").fill("8");
  await page.locator("#page-number").press("Enter");
  await expect(page.locator("#pdf-text")).toContainText("Continuous page 8");
  await expect
    .poll(() =>
      page.locator('[data-pdf-page="1"] canvas').evaluate((el) => el.width),
    )
    .toBe(1);
  expect(
    await page
      .locator(".pdf-canvas")
      .evaluateAll((els) => els.filter((el) => el.width > 1).length),
  ).toBeLessThanOrEqual(5);
  await page.locator("#back").click();
  await page.locator(".book-open").click();
  await expect(page.locator("#reader-loading")).toBeHidden();
  await expect(page.locator("#page-number")).toHaveValue("8");
  await expect(page.locator("#pdf-text")).toContainText("Continuous page 8");
  await page.locator("#page-number").fill("1");
  await page.locator("#page-number").press("Enter");
  await page.locator("#pdf-container").evaluate((el) => (el.scrollTop = 750));
  await page.screenshot({ path: "test-results/continuous-pdf-desktop.png" });
});
