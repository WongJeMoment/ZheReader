// Limit PDF parsing concurrency so long papers do not block on one page at a time.
export async function extractPaperText(pdf, signal, progress = () => {}) {
  const pages = new Array(pdf.numPages);
  let next = 1,
    done = 0,
    total = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, pdf.numPages) }, async () => {
      while (next <= pdf.numPages) {
        signal?.throwIfAborted();
        const number = next++;
        const page = await pdf.getPage(number);
        const content = await page.getTextContent();
        signal?.throwIfAborted();
        const text = content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
          )
          .join("")
          .trim();
        total += text.length;
        if (total > 1500000)
          throw new Error("论文正文超过当前带读上限，请拆分 PDF 后阅读。");
        pages[number - 1] = text;
        progress(++done, pdf.numPages);
      }
    }),
  );
  const units = [];
  pages.forEach((text, index) => {
    let remaining = text,
      part = 0;
    while (remaining) {
      let end = Math.min(2800, remaining.length);
      const boundary = remaining.lastIndexOf("\n", end);
      if (boundary > 1400) end = boundary + 1;
      units.push({
        id: `p${index + 1}-s${++part}`,
        page: index + 1,
        text: remaining.slice(0, end),
      });
      remaining = remaining.slice(end);
    }
  });
  return { version: 1, units, empty: pages.filter((text) => !text).length };
}
