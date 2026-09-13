import * as pdfjs from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import ePub from "epubjs";
import "./pdf-text.css";
import { documentText } from "./speech";
pdfjs.GlobalWorkerOptions.workerSrc = worker;
const assets = new URL(
  `${import.meta.env.BASE_URL}pdf-assets/`,
  document.baseURI,
).href;
const pdfOptions = (data) => ({
  data: new Uint8Array(data),
  cMapUrl: `${assets}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${assets}standard_fonts/`,
  wasmUrl: `${assets}wasm/`,
  isEvalSupported: false,
});
export async function inspectBook(data, type) {
  if (type === "pdf") {
    const task = pdfjs.getDocument(pdfOptions(data));
    // Allow encrypted PDFs onto the shelf; request the password only when reading.
    task.onPassword = () => task.destroy();
    let doc;
    try {
      doc = await task.promise;
      const meta = await doc.getMetadata().catch(() => ({}));
      return {
        title: meta.info?.Title,
        author: meta.info?.Author,
        pages: doc.numPages,
      };
    } catch (e) {
      if (task.destroyed) return { pages: 0 };
      throw e;
    } finally {
      await task.destroy();
    }
  }
  const book = ePub();
  try {
    await book.open(data);
    await book.opened;
    await book.ready;
    const meta = await book.loaded.metadata;
    return { title: meta.title, author: meta.creator };
  } finally {
    book.destroy();
  }
}
export class Reader {
  constructor(options) {
    Object.assign(this, options);
    this.scale = 1;
    this.page = Number(this.book.position) || 1;
    this.destroyed = false;
    this.renderVersion = 0;
    this.atStart = false;
    this.atEnd = false;
    this.selectionAbort = new AbortController();
  }
  watchSelection(doc, root) {
    const publish = () => {
      if (this.destroyed) return;
      const selection = doc.getSelection();
      if (
        selection?.rangeCount &&
        root.contains(selection.anchorNode) &&
        root.contains(selection.focusNode)
      ) {
        const text = selection.toString().trim();
        if (text) {
          const rect = selection.getRangeAt(0).getBoundingClientRect();
          const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
          this.onSelection?.(text, {
            left: rect.left + (frame?.left || 0),
            bottom: rect.bottom + (frame?.top || 0),
          });
        }
      }
    };
    doc.addEventListener("pointerup", publish, {
      signal: this.selectionAbort.signal,
    });
    doc.addEventListener("keyup", publish, {
      signal: this.selectionAbort.signal,
    });
    root.addEventListener("pointerdown", () => this.onSelection?.(""), {
      signal: this.selectionAbort.signal,
    });
  }
  async *speechSections({ fromCurrent = false, signal } = {}) {
    if (this.pdf) {
      const start = fromCurrent ? this.page : 1;
      for (
        let pageNumber = start;
        pageNumber <= this.pdf.numPages;
        pageNumber++
      ) {
        if (signal?.aborted || this.destroyed) return;
        const page = await this.pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        if (signal?.aborted || this.destroyed) return;
        const text = content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
          )
          .join("")
          .trim();
        yield { text, location: `第 ${pageNumber} / ${this.pdf.numPages} 页` };
      }
    } else if (this.epub) {
      const current = this.rendition?.currentLocation()?.start;
      const index = fromCurrent
        ? this.epub.spine.get(current?.cfi)?.index || 0
        : 0;
      for (const section of this.epub.spine.spineItems) {
        if (section.index < index || !section.linear) continue;
        if (signal?.aborted || this.destroyed) return;
        // Load a detached document, leaving displayed pages and location generation alone.
        const doc = await this.epub.load(section.url);
        if (signal?.aborted || this.destroyed) return;
        const body = doc.querySelector("body") || doc.documentElement;
        const text = documentText(body);
        const chapter = this.epub.navigation.get(section.href);
        yield {
          text,
          location: chapter?.label?.trim() || `第 ${section.index + 1} 章`,
        };
      }
    }
  }
  open() {
    this.opening = this.openInternal();
    return this.opening;
  }
  async openInternal() {
    if (this.book.type === "pdf") {
      this.loadingTask = pdfjs.getDocument(pdfOptions(this.data));
      this.loadingTask.onPassword = (update, reason) => {
        const password = window.prompt(
          reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD
            ? "密码不正确，请重新输入 PDF 密码："
            : "此 PDF 已加密，请输入密码：",
        );
        if (password === null) {
          this.loadingTask.destroy();
          this.onError("已取消打开加密 PDF");
        } else update(password);
      };
      this.pdf = await this.loadingTask.promise;
      if (this.destroyed) return;
      this.book.pages = this.pdf.numPages;
      this.page = Math.max(1, Math.min(this.pdf.numPages, this.page));
      this.pdf
        .getOutline()
        .then(async (outline) => {
          const flatten = async (items, depth = 0) => {
            const results = [];
            for (const item of items || []) {
              try {
                const dest =
                  typeof item.dest === "string"
                    ? await this.pdf.getDestination(item.dest)
                    : item.dest;
                if (dest)
                  results.push({
                    label: item.title,
                    target:
                      typeof dest[0] === "number"
                        ? dest[0] + 1
                        : (await this.pdf.getPageIndex(dest[0])) + 1,
                    depth,
                  });
                results.push(...(await flatten(item.items, depth + 1)));
              } catch {
                /* Skip broken outline entries. */
              }
            }
            return results;
          };
          const entries = await flatten(outline);
          if (!this.destroyed) this.onToc(entries);
        })
        .catch(() => {});
      this.watchSelection(document, document.querySelector("#pdf-text"));
      await this.renderPdf();
    } else {
      this.epub = ePub();
      await this.epub.open(this.data);
      await this.epub.opened;
      await this.epub.ready;
      if (this.destroyed) return;
      this.rendition = this.epub.renderTo("epub-container", {
        width: "100%",
        height: "100%",
        spread: "none",
        flow: "paginated",
        allowScriptedContent: false,
      });
      this.rendition.hooks.content.register((contents) =>
        this.watchSelection(contents.document, contents.document.body),
      );
      this.rendition.themes.default({
        body: {
          "font-family":
            'Georgia, "Noto Serif SC", "Songti SC", serif !important',
          "line-height": "1.9 !important",
          padding: "0 5% !important",
        },
        p: { "line-height": "1.9 !important" },
        img: { "max-width": "100% !important", "object-fit": "contain" },
        a: { color: "#7e9e7a !important" },
      });
      this.setTheme(document.documentElement.dataset.theme);
      this.setFontSize(this.fontSize);
      this.rendition.on("relocated", (location) => this.reportEpub(location));
      this.rendition.on("displayError", () =>
        this.onError("章节显示失败，试试从目录打开其他章节"),
      );
      this.rendition.on("keyup", (e) => {
        if (e.shiftKey) return;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight")
          this.turn(e.key === "ArrowLeft" ? -1 : 1).catch(() =>
            this.onError("翻页失败"),
          );
      });
      const navigation = await this.epub.loaded.navigation;
      const flatten = (items, depth = 0) =>
        items.flatMap((item) => [
          { label: item.label.trim(), target: item.href, depth },
          ...flatten(item.subitems || [], depth + 1),
        ]);
      this.onToc(flatten(navigation.toc));
      try {
        await this.rendition.display(this.book.position || undefined);
      } catch {
        await this.rendition.display();
      }
      if (this.destroyed) return;
      this.epub.locations
        .generate(1200)
        .then(() => {
          this.locationsReady = true;
          if (!this.destroyed && this.rendition?.currentLocation()?.start)
            this.reportEpub(this.rendition.currentLocation());
        })
        .catch(() => {});
    }
    if (this.destroyed) return;
    let resizeTimer;
    this.resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (this.destroyed) return;
        if (this.pdf) this.renderPdf().catch(() => {});
        else this.rendition?.resize();
      }, 150);
    });
    this.resizeObserver.observe(document.querySelector("#reading-stage"));
  }
  reportEpub(location) {
    if (this.destroyed || !location?.start) return;
    const section = this.epub.spine.get(location.start.cfi);
    const total = this.epub.spine.spineItems.length;
    let progress = this.locationsReady
      ? this.epub.locations.percentageFromCfi(location.start.cfi)
      : (section?.index || 0) / Math.max(1, total);
    if (location.atEnd) progress = 1;
    const chapter = this.epub.navigation.get(location.start.href);
    this.atStart = location.atStart;
    this.atEnd = location.atEnd;
    this.onProgress(
      location.start.cfi,
      progress || 0,
      chapter?.label?.trim() || `章节 ${(section?.index || 0) + 1} / ${total}`,
    );
  }
  async renderPdf() {
    if (this.destroyed) return;
    const version = ++this.renderVersion;
    if (this.renderTask) {
      this.renderTask.cancel();
      await this.renderTask.promise.catch(() => {});
    }
    this.textLayer?.cancel();
    const pageNumber = this.page;
    const page = await this.pdf.getPage(pageNumber);
    if (version !== this.renderVersion || this.destroyed) return;
    const container = document.querySelector("#pdf-container");
    const original = page.getViewport({ scale: 1 });
    const width = Math.min(
      900,
      Math.max(
        260,
        container.clientWidth - (window.innerWidth < 600 ? 24 : 80),
      ),
    );
    const viewport = page.getViewport({
      scale: (width / original.width) * this.scale,
    });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.querySelector("#pdf-canvas");
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const wrapper = document.querySelector("#pdf-page");
    wrapper.style.width = `${viewport.width}px`;
    wrapper.style.height = `${viewport.height}px`;
    wrapper.style.setProperty("--scale-factor", viewport.scale);
    wrapper.style.setProperty("--total-scale-factor", viewport.scale);
    const layer = document.querySelector("#pdf-text");
    layer.innerHTML = "";
    this.renderTask = page.render({
      canvasContext: canvas.getContext("2d"),
      viewport,
      transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
    });
    try {
      await this.renderTask.promise;
    } catch (e) {
      if (e.name === "RenderingCancelledException") return;
      throw e;
    }
    if (version !== this.renderVersion || this.destroyed) return;
    this.textLayer = new pdfjs.TextLayer({
      textContentSource: await page.getTextContent(),
      container: layer,
      viewport,
    });
    await this.textLayer.render().catch(() => {});
    if (version !== this.renderVersion || this.destroyed) return;
    this.atStart = pageNumber === 1;
    this.atEnd = pageNumber === this.pdf.numPages;
    this.onProgress(
      pageNumber,
      pageNumber / this.pdf.numPages,
      `第 ${pageNumber} 页`,
    );
  }
  async turn(direction) {
    if (this.destroyed || this.turning) return;
    this.turning = true;
    try {
      if (this.pdf) await this.go(this.page + direction);
      else if (this.rendition)
        await (direction > 0 ? this.rendition.next() : this.rendition.prev());
    } finally {
      this.turning = false;
    }
  }
  async go(target) {
    if (this.destroyed) return;
    if (this.pdf) {
      this.page = Math.max(1, Math.min(this.pdf.numPages, Number(target)));
      await this.renderPdf();
      document.querySelector("#pdf-container").scrollTop = 0;
    } else if (this.rendition) await this.rendition.display(target);
  }
  setTheme(theme) {
    if (!this.rendition) return;
    this.rendition.themes.override(
      "color",
      theme === "dark" ? "#ced4c8" : "#3e463b",
      true,
    );
    this.rendition.themes.override(
      "background",
      theme === "dark" ? "#202621" : "#faf8ef",
      true,
    );
  }
  setFontSize(size) {
    this.fontSize = size;
    this.rendition?.themes.fontSize(`${size}px`);
  }
  zoom(delta) {
    this.scale = Math.max(
      0.5,
      Math.min(2.5, Math.round((this.scale + delta * 0.1) * 10) / 10),
    );
    this.renderPdf().catch(() => this.onError("页面缩放失败"));
  }
  destroy() {
    this.destroyed = true;
    this.selectionAbort.abort();
    this.renderVersion++;
    this.resizeObserver?.disconnect();
    this.renderTask?.cancel();
    this.textLayer?.cancel();
    this.loadingTask?.destroy().catch(() => {});
    // epub.js mutates its loading state until opening completes. Release only
    // this instance's DOM/resources afterward, without clearing a newer book.
    const dispose = () => this.epub?.destroy();
    if (this.opening) this.opening.then(dispose, dispose).catch(() => {});
    else dispose();
  }
}
