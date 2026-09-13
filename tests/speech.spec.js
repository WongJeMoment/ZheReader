import { test, expect } from "@playwright/test";
import { samplePdf } from "./fixtures";
import { splitSpeechText, SpeechPlayer } from "../src/speech";

async function mockSpeech(page, { empty = false } = {}) {
  await page.addInitScript(
    ({ empty }) => {
      class Utterance {
        constructor(text) {
          this.text = text;
        }
      }
      const voices = [
        {
          voiceURI: "zh-local",
          name: "中文本地声音",
          lang: "zh-CN",
          localService: true,
          default: true,
        },
        {
          voiceURI: "en-local",
          name: "English local",
          lang: "en-US",
          localService: true,
        },
        {
          voiceURI: "zh-online",
          name: "中文在线声音",
          lang: "zh-CN",
          localService: false,
        },
      ];
      const engine = new EventTarget();
      const state = (window.__speech = {
        calls: [],
        controls: [],
        current: null,
        voices: empty ? [] : voices,
      });
      engine.getVoices = () => state.voices;
      engine.speak = (utterance) => {
        state.current = utterance;
        state.calls.push({
          text: utterance.text,
          voice: utterance.voice?.voiceURI,
          rate: utterance.rate,
          pitch: utterance.pitch,
          volume: utterance.volume,
        });
        utterance.onstart?.();
      };
      engine.cancel = () => {
        state.controls.push("cancel");
        const current = state.current;
        state.current = null;
        queueMicrotask(() => current?.onerror?.({ error: "canceled" }));
      };
      engine.pause = () => state.controls.push("pause");
      engine.resume = () => state.controls.push("resume");
      state.finish = () => {
        const current = state.current;
        state.current = null;
        current?.onend?.();
      };
      state.fail = (error) => state.current?.onerror?.({ error });
      state.loadVoices = () => {
        state.voices = voices;
        engine.dispatchEvent(new Event("voiceschanged"));
      };
      Object.defineProperty(window, "speechSynthesis", {
        value: engine,
        configurable: true,
      });
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        value: Utterance,
        configurable: true,
      });
    },
    { empty },
  );
}
async function openPdf(page) {
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({
    name: "Speech.pdf",
    mimeType: "application/pdf",
    buffer: samplePdf(),
  });
  await page.getByRole("button", { name: "阅读 Speech", exact: true }).click();
  await expect(page.locator("#reader-loading")).toBeHidden();
  await page.getByRole("button", { name: "语音朗读", exact: true }).click();
}
async function openEpub(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "探索阅读体验", exact: true }).click();
  await expect(page.locator("#reader-view")).toBeVisible();
  await expect(page.locator("#reader-loading")).toBeHidden();
  await page.getByRole("button", { name: "语音朗读", exact: true }).click();
}

test("long Chinese and English passages split without truncation", () => {
  const text =
    "这是一段很长的中文文字。".repeat(120) +
    "A very long English passage with no full stops ".repeat(70) +
    "😀".repeat(160);
  const chunks = splitSpeechText(text);
  expect(chunks.every((c) => Array.from(c).length <= 140)).toBe(true);
  expect(chunks.join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
});
test("stopping during extraction prevents stale speech from starting", async () => {
  let resolve;
  const text = new Promise((r) => (resolve = r));
  const calls = [];
  const engine = {
    getVoices: () => [],
    addEventListener() {},
    cancel() {},
    resume() {},
    speak: (u) => calls.push(u.text),
  };
  const player = new SpeechPlayer({
    engine,
    Utterance: class {
      constructor(text) {
        this.text = text;
      }
    },
  });
  const started = player.start(async function* () {
    yield { text: await text, location: "Page 1" };
  }, "Test");
  player.stop();
  resolve("Old book");
  await started;
  expect(calls).toEqual([]);
  expect(player.state).toBe("idle");
});
test("PDF entire document, pause, resume, completion and current page", async ({
  page,
}) => {
  await mockSpeech(page);
  await openPdf(page);
  await page.locator("#speech-all").click();
  await expect
    .poll(() => page.evaluate(() => __speech.calls.at(-1)?.text))
    .toBe("Hello ZheReader");
  await page.locator("#speech-pause").click();
  await expect(page.locator("#speech-state")).toHaveText("已暂停");
  await page.locator("#speech-pause").click();
  await expect(page.locator("#speech-state")).toHaveText("正在朗读");
  await page.evaluate(() => __speech.finish());
  await expect
    .poll(() => page.evaluate(() => __speech.calls.at(-1)?.text))
    .toBe("The second page");
  await expect(page.locator("#speech-location")).toContainText("第 2 / 2 页");
  await page.evaluate(() => __speech.finish());
  await expect(page.locator("#speech-state")).toHaveText("本次朗读已完成");
  await page.locator("#next-page").click();
  await expect(page.locator("#page-number")).toHaveValue("2");
  await page.locator("#speech-current").click();
  await expect.poll(() => page.evaluate(() => __speech.calls.length)).toBe(3);
  expect(await page.evaluate(() => __speech.calls.at(-1).text)).toBe(
    "The second page",
  );
  await page.locator("#back").click();
  expect(await page.evaluate(() => __speech.current)).toBeNull();
});
test("desktop PDF selection reads only selected text and settings persist", async ({
  page,
}) => {
  await mockSpeech(page);
  await openPdf(page);
  await page
    .locator("#pdf-text span")
    .first()
    .evaluate((span) => {
      const range = document.createRange();
      range.setStart(span.firstChild, 6);
      range.setEnd(span.firstChild, 15);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      selection.anchorNode.ownerDocument.dispatchEvent(new Event("pointerup"));
    });
  await expect(page.locator("#selection-speak")).toBeVisible();
  await page.locator("#speech-voice").selectOption("zh-online");
  await expect(page.locator("#voice-note")).toContainText("发送给语音服务商");
  await page.locator("#speech-rate").fill("1.4");
  await page.locator("#speech-pitch").fill("1.2");
  await page.locator("#speech-volume").fill("0.5");
  await page.locator("#selection-speak").click();
  await expect
    .poll(() => page.evaluate(() => __speech.calls.at(-1)))
    .toEqual({
      text: "ZheReader",
      voice: "zh-online",
      rate: 1.4,
      pitch: 1.2,
      volume: 0.5,
    });
  await page.locator("#speech-pause").click();
  const count = await page.evaluate(() => __speech.calls.length);
  await page.locator("#speech-voice").selectOption("zh-local");
  await expect(page.locator("#speech-state")).toHaveText("已暂停");
  expect(await page.evaluate(() => __speech.calls.length)).toBe(count);
  await page.locator("#speech-pause").click();
  await expect
    .poll(() => page.evaluate(() => __speech.calls.at(-1)?.voice))
    .toBe("zh-local");
  await page.reload();
  await page.getByRole("button", { name: "继续阅读" }).click();
  await expect(page.locator("#reader-loading")).toBeHidden();
  await page.locator("#speech-toggle").click();
  await expect(page.locator("#speech-voice")).toHaveValue("zh-local");
  await expect(page.locator("#speech-rate")).toHaveValue("1.4");
  await expect(page.locator("#speech-pitch")).toHaveValue("1.2");
  await expect(page.locator("#speech-volume")).toHaveValue("0.5");
});
test("EPUB full reading reaches final chapter and selection survives iframe focus change", async ({
  page,
}) => {
  await mockSpeech(page);
  await openEpub(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const frame = page.frameLocator("#epub-container iframe");
  await frame
    .locator("p")
    .first()
    .evaluate((p) => {
      const range = p.ownerDocument.createRange();
      range.setStart(p.firstChild, 0);
      range.setEnd(p.firstChild, 9);
      const selection = p.ownerDocument.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      selection.anchorNode.ownerDocument.dispatchEvent(new Event("pointerup"));
    });
  await expect(page.locator("#selection-count")).toHaveText("9 字");
  await page.locator("#speech-selected").click();
  await expect
    .poll(() => page.evaluate(() => __speech.calls.at(-1)?.text))
    .toBe("我们每天读很多文字");
  await page.locator("#speech-all").click();
  for (let step = 0; step < 150; step++) {
    const done = await page.locator("#speech-state").textContent();
    if (done === "本次朗读已完成") break;
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            !!__speech.current ||
            document.querySelector("#speech-state").textContent ===
              "本次朗读已完成",
        ),
      )
      .toBe(true);
    await page.evaluate(() => __speech.finish());
  }
  await expect(page.locator("#speech-state")).toHaveText("本次朗读已完成");
  const all = await page.evaluate(() =>
    __speech.calls
      .slice(1)
      .map((c) => c.text)
      .join(""),
  );
  expect(all).toContain("慢读时光");
  expect(all).toContain("窗边的光");
  expect(all).toContain("在字里行间散步");
  expect(all).toContain("夜色也是一张书签");
  expect(all).toContain("慢慢读，也慢慢生活");
  expect(errors).toEqual([]);
});
test("late voices, playback failure and recovery", async ({ page }) => {
  await mockSpeech(page, { empty: true });
  await openPdf(page);
  await expect(page.locator("#voice-note")).toContainText("语音包");
  await page.evaluate(() => __speech.loadVoices());
  await expect(page.locator("#speech-voice option")).toHaveCount(4);
  await page.locator("#speech-all").click();
  await expect(page.locator("#speech-state")).toHaveText("正在朗读");
  await page.evaluate(() => __speech.fail("network"));
  await expect(page.locator("#speech-state")).toHaveText("朗读未能继续");
  await expect(page.locator("#toast")).toContainText("在线声音连接失败");
  await page.locator("#speech-voice").selectOption("zh-local");
  await page.locator("#speech-all").click();
  await expect(page.locator("#speech-state")).toHaveText("正在朗读");
  await page.locator("#speech-stop").click();
  await expect(page.locator("#speech-state")).toHaveText("准备好就开始吧");
});
