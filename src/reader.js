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
          this.onSelection?.(
            text,
            {
              left: rect.left + (frame?.left || 0),
              bottom: rect.bottom + (frame?.top || 0),
            },
            this.captureAnnotation(selection),
          );
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
  captureAnnotation(selection) {
    if (!this.pdf) return null;
    const range = selection.getRangeAt(0);
    const element = (node) => (node.nodeType === 1 ? node : node.parentElement);
    const wrapper = element(range.startContainer)?.closest("[data-pdf-page]");
    if (
      !wrapper ||
      wrapper !== element(range.endContainer)?.closest("[data-pdf-page]")
    )
      return null;
    const record = this.pdfRows?.[Number(wrapper.dataset.pdfPage) - 1];
    if (!record?.viewport || !record.ready) return null;
    const bounds = wrapper.getBoundingClientRect(),
      viewport = record.viewport,
      pageNumber = record.number;
    const rects = [],
      seen = new Set();
    for (const rect of range.getClientRects()) {
      const left = Math.max(0, rect.left - bounds.left),
        top = Math.max(0, rect.top - bounds.top),
        right = Math.min(bounds.width, rect.right - bounds.left),
        bottom = Math.min(bounds.height, rect.bottom - bounds.top);
      if (right - left < 0.5 || bottom - top < 0.5) continue;
      const a = viewport.convertToPdfPoint(left, top),
        b = viewport.convertToPdfPoint(right, bottom);
      const pdfRect = [
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.max(a[0], b[0]),
        Math.max(a[1], b[1]),
      ].map((n) => Math.round(n * 1000) / 1000);
      const key = pdfRect.join(",");
      if (!seen.has(key)) {
        seen.add(key);
        rects.push(pdfRect);
      }
    }
    if (!rects.length || rects.length > 200) return null;
    const prefix = range.cloneRange();
    prefix.selectNodeContents(record.layer);
    prefix.setEnd(range.startContainer, range.startOffset);
    const offset = Math.min(999999, prefix.toString().length),
      distance = Math.max(
        0,
        Math.min(
          99999,
          Math.floor((record.proxy.view?.[3] || 0) - rects[0][3]),
        ),
      );
    return {
      position: { pageIndex: pageNumber - 1, rects },
      pageLabel: this.pageLabels?.[pageNumber - 1] || String(pageNumber),
      sortIndex: `${String(pageNumber - 1).padStart(5, "0")}|${String(offset).padStart(6, "0")}|${String(distance).padStart(5, "0")}`,
    };
  }
  setAnnotations(annotations) {
    this.annotations = annotations;
    this.renderAnnotations();
  }
  renderAnnotations() {
    for (const record of this.pdfRows || []) {
      const layer = record.marks;
      if (!record.ready || !record.viewport) continue;
      layer.replaceChildren();
      for (const annotation of this.annotations || []) {
        if (annotation.position.pageIndex !== record.number - 1) continue;
        for (const rect of annotation.position.rects) {
          const r = [
              ...record.viewport.convertToViewportPoint(rect[0], rect[1]),
              ...record.viewport.convertToViewportPoint(rect[2], rect[3]),
            ],
            mark = document.createElement("span");
          const left = Math.min(r[0], r[2]),
            top = Math.min(r[1], r[3]),
            width = Math.abs(r[2] - r[0]),
            height = Math.abs(r[3] - r[1]);
          mark.className = "pdf-highlight " + annotation.type;
          mark.dataset.annotation = annotation.key;
          Object.assign(mark.style, {
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
          });
          mark.style.setProperty("--mark-color", annotation.color);
          layer.append(mark);
        }
      }
    }
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
      this.watchSelection(document, document.querySelector("#pdf-container"));
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
      this.rendition.hooks.content.register((contents) => {
        this.watchSelection(contents.document, contents.document.body);
        contents.document.addEventListener(
          "wheel",
          (e) => {
            if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) < 2) return;
            e.preventDefault();
            if (Date.now() - (this.lastEpubWheel || 0) < 350) return;
            this.lastEpubWheel = Date.now();
            this.turn(e.deltaY > 0 ? 1 : -1).catch(() =>
              this.onError("翻页失败"),
            );
          },
          { passive: false },
        );
      });
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
  async initPdfPages() {
    const container = document.querySelector("#pdf-container");
    container.replaceChildren();
    this.pdfRows = [];
    for (let number = 1; number <= this.pdf.numPages; number++) {
      const wrapper = document.createElement("div");
      wrapper.className = "pdf-page";
      wrapper.dataset.pdfPage = number;
      wrapper.setAttribute("aria-label", `第 ${number} 页`);
      const canvas = document.createElement("canvas");
      canvas.className = "pdf-canvas";
      const marks = document.createElement("div");
      marks.className = "pdf-annotations";
      const layer = document.createElement("div");
      layer.className = "pdf-text textLayer";
      wrapper.append(canvas, marks, layer);
      container.append(wrapper);
      this.pdfRows.push({
        number,
        wrapper,
        canvas,
        marks,
        layer,
        ready: false,
        epoch: 0,
      });
    }
    for (let start = 0; start < this.pdfRows.length; start += 16) {
      if (this.destroyed) return;
      await Promise.all(
        this.pdfRows.slice(start, start + 16).map(async (row) => {
          row.proxy = await this.pdf.getPage(row.number);
          row.original = row.proxy.getViewport({ scale: 1 });
        }),
      );
    }
    container.addEventListener(
      "scroll",
      () => {
        if (this.scrollFrame) return;
        this.scrollFrame = requestAnimationFrame(() => {
          this.scrollFrame = null;
          if (!this.destroyed && !this.layoutBusy)
            this.updatePdfWindow().catch((e) => this.onError(e.message));
        });
      },
      { passive: true, signal: this.selectionAbort.signal },
    );
  }
  activatePdfPage(number) {
    const previous = this.pdfRows[this.page - 1];
    if (previous)
      for (const node of [
        previous.wrapper,
        previous.canvas,
        previous.layer,
        previous.marks,
      ])
        node.removeAttribute("id");
    const changed = this.page !== number;
    this.page = number;
    const row = this.pdfRows[number - 1];
    row.wrapper.id = "pdf-page";
    row.canvas.id = "pdf-canvas";
    row.layer.id = "pdf-text";
    row.marks.id = "pdf-annotations";
    this.viewport = row.viewport;
    this.pageView = row.proxy.view;
    this.renderedPage = row.ready ? number : null;
    this.atStart = number === 1;
    this.atEnd = number === this.pdf.numPages;
    if (changed || !this.reportedPdfPage) {
      this.reportedPdfPage = number;
      this.onProgress(number, number / this.pdf.numPages, `第 ${number} 页`);
    }
  }
  pageAt(offset) {
    let lo = 0,
      hi = this.pdfRows.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.pdfRows[mid].wrapper.offsetTop <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  async updatePdfWindow() {
    if (this.destroyed || !this.pdfRows?.length) return;
    const container = document.querySelector("#pdf-container");
    const first = this.pageAt(container.scrollTop),
      last = this.pageAt(container.scrollTop + container.clientHeight);
    const current =
      container.scrollTop > 0 &&
      container.scrollTop + container.clientHeight >= container.scrollHeight - 2
        ? this.pdfRows.length - 1
        : this.pageAt(
            container.scrollTop + Math.min(240, container.clientHeight * 0.35),
          );
    this.activatePdfPage(current + 1);
    const pending = [];
    for (let i = 0; i < this.pdfRows.length; i++) {
      const row = this.pdfRows[i];
      if (
        i >= Math.max(0, first - 1) &&
        i <= Math.min(this.pdfRows.length - 1, last + 1)
      )
        pending.push(this.renderPdfRow(row));
      else if (row.ready || row.promise) this.clearPdfRow(row);
    }
    await Promise.all(pending);
    if (!this.destroyed) {
      this.activatePdfPage(this.page);
      this.renderAnnotations();
    }
  }
  clearPdfRow(row) {
    row.epoch++;
    row.task?.cancel();
    row.retiring = row.task?.promise.catch(() => {});
    row.textLayer?.cancel();
    row.task = null;
    row.promise = null;
    row.ready = false;
    row.canvas.width = 1;
    row.canvas.height = 1;
    row.canvas.style.width = "100%";
    row.canvas.style.height = "100%";
    row.layer.replaceChildren();
    row.marks.replaceChildren();
  }
  async renderPdfRow(row) {
    if (row.ready) return;
    if (row.promise) return row.promise;
    const epoch = row.epoch;
    row.promise = (async () => {
      await row.retiring;
      if (this.destroyed || row.epoch !== epoch) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2),
        viewport = row.viewport;
      row.canvas.width = Math.floor(viewport.width * ratio);
      row.canvas.height = Math.floor(viewport.height * ratio);
      row.canvas.style.width = `${viewport.width}px`;
      row.canvas.style.height = `${viewport.height}px`;
      row.task = row.proxy.render({
        canvasContext: row.canvas.getContext("2d"),
        viewport,
        transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
      });
      await row.task.promise;
      if (this.destroyed || row.epoch !== epoch) return;
      row.textLayer = new pdfjs.TextLayer({
        textContentSource: await row.proxy.getTextContent(),
        container: row.layer,
        viewport,
      });
      if (this.destroyed || row.epoch !== epoch) return;
      await row.textLayer.render();
      if (this.destroyed || row.epoch !== epoch) return;
      row.ready = true;
    })()
      .catch((e) => {
        if (
          e.name !== "RenderingCancelledException" &&
          !this.destroyed &&
          row.epoch === epoch
        )
          throw e;
      })
      .finally(() => {
        if (row.epoch === epoch) row.promise = null;
      });
    return row.promise;
  }
  async renderPdf() {
    if (this.destroyed) return;
    const version = ++this.renderVersion;
    this.layoutBusy = true;
    if (!this.pdfRows) await (this.pdfInit ||= this.initPdfPages());
    else if (this.pdfInit) await this.pdfInit;
    if (this.destroyed || version !== this.renderVersion) return;
    const container = document.querySelector("#pdf-container");
    const current = this.pdfRows[this.page - 1];
    const oldOffset = current.wrapper.offsetTop,
      oldScroll = container.scrollTop;
    const width = Math.min(
      900,
      Math.max(
        260,
        container.clientWidth - (window.innerWidth < 600 ? 24 : 80),
      ),
    );
    const layout = width * this.scale;
    if (this.pdfLayout !== layout) {
      this.pdfLayout = layout;
      const cancelled = this.pdfRows.map((row) => row.promise?.catch(() => {}));
      this.pdfRows.forEach((row) => this.clearPdfRow(row));
      await Promise.all(cancelled);
      if (this.destroyed || version !== this.renderVersion) return;
      for (const row of this.pdfRows) {
        row.viewport = row.proxy.getViewport({
          scale: layout / row.original.width,
        });
        row.wrapper.style.width = `${row.viewport.width}px`;
        row.wrapper.style.height = `${row.viewport.height}px`;
        row.wrapper.style.setProperty("--scale-factor", row.viewport.scale);
        row.wrapper.style.setProperty(
          "--total-scale-factor",
          row.viewport.scale,
        );
      }
      container.scrollTop = this.pdfPositioned
        ? oldScroll + current.wrapper.offsetTop - oldOffset
        : current.wrapper.offsetTop - 28;
      this.pdfPositioned = true;
    }
    this.layoutBusy = false;
    await this.updatePdfWindow();
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
      this.activatePdfPage(
        Math.max(1, Math.min(this.pdf.numPages, Number(target))),
      );
      const row = this.pdfRows?.[this.page - 1];
      if (row) {
        document.querySelector("#pdf-container").scrollTop =
          row.wrapper.offsetTop - 28;
        await this.updatePdfWindow();
      }
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
  zoom(delta, anchor) {
    const container = document.querySelector("#pdf-container");
    const page = document.querySelector("#pdf-page");
    const before = page.getBoundingClientRect();
    const bounds = container.getBoundingClientRect();
    const x = anchor?.x ?? bounds.left + bounds.width / 2;
    const y = anchor?.y ?? bounds.top + bounds.height / 2;
    const relative = {
      x: (x - before.left) / before.width,
      y: (y - before.top) / before.height,
    };
    this.scale = Math.max(
      0.5,
      Math.min(2.5, Math.round((this.scale + delta * 0.1) * 10) / 10),
    );
    const scale = this.scale;
    this.renderPdf()
      .then(() => {
        if (this.destroyed || this.scale !== scale) return;
        const after = page.getBoundingClientRect();
        container.scrollLeft += after.left + relative.x * after.width - x;
        container.scrollTop += after.top + relative.y * after.height - y;
      })
      .catch(() => this.onError("页面缩放失败"));
  }
  destroy() {
    this.destroyed = true;
    this.selectionAbort.abort();
    this.renderVersion++;
    this.resizeObserver?.disconnect();
    for (const row of this.pdfRows || []) this.clearPdfRow(row);
    cancelAnimationFrame(this.scrollFrame);
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
