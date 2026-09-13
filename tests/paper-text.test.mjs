import test from "node:test";
import assert from "node:assert/strict";
import { extractPaperText } from "../src/paper-text.js";
test("parallel paper extraction is bounded and retains physical page order and all text", async () => {
  let active = 0,
    peak = 0;
  const pdf = {
    numPages: 8,
    async getPage(number) {
      return {
        async getTextContent() {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 9 - number));
          active--;
          return {
            items: [
              { str: `Page ${number} ` + "x".repeat(3000), hasEOL: true },
            ],
          };
        },
      };
    },
  };
  const result = await extractPaperText(pdf, new AbortController().signal);
  assert.equal(peak, 4);
  assert.equal(result.units.length, 16);
  for (let page = 1; page <= 8; page++)
    assert.equal(
      result.units
        .filter((u) => u.page === page)
        .map((u) => u.text)
        .join(""),
      `Page ${page} ` + "x".repeat(3000),
    );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(extractPaperText(pdf, controller.signal), {
    name: "AbortError",
  });
});
