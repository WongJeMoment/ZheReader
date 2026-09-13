import {
  createIcons,
  BookOpen,
  Library,
  Clock3,
  Bookmark,
  Search,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Upload,
  Sun,
  Moon,
  Monitor,
  X,
  ChevronLeft,
  ChevronRight,
  List,
  Minus,
  Maximize,
  Trash2,
  Leaf,
  Check,
  Headphones,
  Volume2,
  Play,
  Pause,
  Square,
  Languages,
  Copy,
  Network,
  Lightbulb,
  Sparkles,
  UserRound,
  Cloud,
  Highlighter,
} from "lucide";
import { listBooks, getFile, putBook, removeBook } from "./storage";
import { readPreference, savePreference, resolvedTheme } from "./theme";
import "./style.css";
import { createZoteroPanel } from "./zotero-panel";
import { createAnnotationPanel } from "./annotation-panel";
import { createCloudPanel } from "./cloud-panel";
import { createStudyPanel } from "./study-panel";
import { createSpeechPanel } from "./speech-panel";
const iconSet = {
  BookOpen,
  Library,
  Clock3,
  Bookmark,
  Search,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Upload,
  Sun,
  Moon,
  Monitor,
  X,
  ChevronLeft,
  ChevronRight,
  List,
  Minus,
  Maximize,
  Trash2,
  Leaf,
  Check,
  Headphones,
  Volume2,
  Play,
  Pause,
  Square,
  Languages,
  Copy,
  Network,
  Lightbulb,
  Sparkles,
  UserRound,
  Cloud,
  Highlighter,
};
const i = (name, cls = "") => `<i data-lucide="${name}" class="${cls}"></i>`;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let books = [],
  filter = "all",
  query = "",
  sort = "recent",
  importing = false,
  active = null,
  reader = null,
  openToken = 0;
let themeMode = readPreference("zr-theme", "auto");
if (!["auto", "light", "dark"].includes(themeMode)) themeMode = "auto";
let fontSize = Number(readPreference("zr-font", "20")) || 20;
const app = document.querySelector("#app");
app.innerHTML = `
<div class="shell" id="library-view">
  <aside class="sidebar">
    <a class="brand" href="./" aria-label="ZheReader 首页"><span class="brand-icon">${i("book-open")}</span><span>ZheReader<span class="brand-dot">.</span></span></a>
    <div class="workspace-label">你的私人阅读空间</div>
    <nav class="nav" aria-label="书架导航">
      <button class="nav-item selected" data-filter="all">${i("library")}<span>我的书架</span><span class="nav-count" id="all-count">0</span></button>
      <button class="nav-item" data-filter="recent">${i("clock-3")}<span>最近阅读</span></button>
      <button class="nav-item" data-filter="bookmarked">${i("bookmark")}<span>我的书签</span></button>
      <button class="nav-item" id="cloud-open">${i("cloud")}<span>坚果云论文</span></button>
      <button class="nav-item" id="zotero-open">${i("highlighter")}<span>Zotero 分类与标注</span></button>
    </nav>
    <div id="zotero-collections" class="zotero-collections"></div>
    <div class="sidebar-note"><div class="little-leaf">${i("leaf")}</div><p>把时间留给<br>值得读的文字。</p><span>A LITTLE LESS NOISE,<br>A LITTLE MORE READING.</span></div>
    <div class="sidebar-bottom"><span class="status-dot"></span>书籍仅保存在此浏览器<button class="icon-button" id="privacy" aria-label="查看存储说明">${i("monitor")}</button></div>
  </aside>
  <div class="main-shell">
    <header class="topbar"><div class="breadcrumb">阅读空间 <span>/</span> <strong id="crumb">我的书架</strong></div><div class="header-right"><span class="theme-label">${i("leaf")} 自动护眼</span><button class="icon-button theme-open" aria-label="主题设置">${i("sun")}</button><button class="secondary account-open" aria-label="GPT 账号">${i("user-round")} GPT 账号</button><span class="avatar">Z</span></div></header>
    <main class="library-main">
      <section class="welcome"><div><div class="eyebrow">YOUR QUIET CORNER</div><h1>让阅读，<span>慢下来。</span></h1><p>翻开一本书，给自己一段不被打扰的时光。</p></div><button class="primary" id="import-top">${i("plus")} 导入书籍</button></section>
      <section class="hero" id="hero"><div class="hero-copy"><span class="hero-kicker"><span class="status-dot"></span> 随时开始一段新的旅程</span><h2>世界很大，<br>也可以藏在一本书里。</h2><p>从你的第一本 PDF 或 EPUB 开始，<br>在这里，找到属于自己的阅读节奏。</p><button class="hero-action" id="demo">探索阅读体验 ${i("arrow-right")}</button></div><div class="book-scene" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><span class="scene-star">✳</span><div class="scene-book rear"><span>THE ART OF<br>SLOW LIVING</span></div><div class="scene-book front"><div class="cover-top">THE QUIET COLLECTION / 01</div><div class="cover-title">慢读<br><em>时光</em></div><div class="cover-line"></div><span class="cover-subtitle">A MOMENT<br>BETWEEN THE PAGES</span><span class="cover-bottom">ZHEREADER ORIGINAL</span></div><span class="scene-caption">ONE PAGE AT A TIME.</span></div></section>
      <section class="shelf"><div class="shelf-heading"><div class="shelf-title"><h2 id="shelf-title">我的书架</h2><span id="book-count">0 本书</span></div><div class="shelf-tools"><label class="search-box">${i("search")}<input id="search" placeholder="搜索书名、作者" aria-label="搜索书名、作者" autocomplete="off"><kbd>/</kbd></label><select id="sort" aria-label="书架排序"><option value="recent">最近打开</option><option value="added">最近添加</option><option value="name">书名排序</option></select></div></div>
      <div class="filter-row"><div class="format-tabs" role="group" aria-label="文件格式"><button class="active" data-format="all">全部</button><button data-format="pdf">PDF</button><button data-format="epub">EPUB</button></div><span class="local-hint">${i("check")} 本地保存，安心阅读</span></div><div id="books" class="book-grid"></div>
      <button class="dropzone" id="dropzone">${i("upload")}<span><strong>拖拽书籍到这里</strong>，或点击选择文件<small>支持 PDF、EPUB · 可一次导入多本</small></span><span class="drop-plus">${i("plus")}</span></button></section>
      <footer class="footer"><span>ZheReader <span class="muted">/ 为专注阅读而生</span></span><span>${i("leaf")} 昼夜流转，好书常伴</span></footer>
    </main>
  </div>
</div>
<section id="reader-view" class="reader-view" hidden aria-label="阅读器">
  <header class="reader-header"><button class="secondary" id="back">${i("chevron-left")}<span>书架</span></button><div class="reader-heading"><strong id="reader-title"></strong><span id="reader-subtitle"></span></div><div class="reader-actions"><button class="icon-button account-open" aria-label="GPT 账号">${i("user-round")}</button><button class="icon-button" id="annotation-toggle" aria-label="论文标注" aria-expanded="false">${i("highlighter")}</button><button class="icon-button" id="study-toggle" aria-label="英语学习助手" aria-expanded="false">${i("languages")}</button><button class="secondary speech-toggle" id="speech-toggle" aria-label="语音朗读" aria-expanded="false" aria-controls="speech-panel">${i("headphones")}<span>听书</span></button><button class="icon-button" id="toc-toggle" aria-label="目录与书签">${i("list")}</button><button class="icon-button" id="add-bookmark" aria-label="添加书签">${i("bookmark")}</button><button class="icon-button theme-open" aria-label="主题设置">${i("sun")}</button><button class="icon-button" id="fullscreen" aria-label="全屏阅读">${i("maximize")}</button></div></header>
  <div class="reader-body"><aside id="toc-panel" class="toc-panel" hidden><div class="toc-header"><h3>目录与书签</h3><button class="icon-button" id="toc-close" aria-label="关闭目录">${i("x")}</button></div><div class="toc-tabs"><button class="active" id="chapters-tab">目录</button><button id="bookmarks-tab">书签</button></div><div id="toc-list"></div></aside><div class="reading-stage" id="reading-stage"><div id="reader-loading" class="reader-loading">正在打开书籍…</div><div id="pdf-container"><div class="pdf-page" id="pdf-page"><canvas id="pdf-canvas"></canvas><div id="pdf-annotations"></div><div id="pdf-text" class="textLayer"></div></div></div><div id="epub-container"></div></div></div>
  <footer class="reader-footer"><span class="reader-progress" id="reader-progress">准备阅读</span><div class="page-controls"><button class="icon-button" id="prev-page" aria-label="上一页">${i("chevron-left")}</button><label id="pdf-jump"><input id="page-number" type="number" min="1" aria-label="跳转页码"><span id="page-total"></span></label><span id="epub-position" hidden></span><button class="icon-button" id="next-page" aria-label="下一页">${i("chevron-right")}</button></div><div class="size-controls"><button class="icon-button" id="size-down" aria-label="缩小字号或页面">${i("minus")}</button><span id="size-label">100%</span><button class="icon-button" id="size-up" aria-label="放大字号或页面">${i("plus")}</button></div></footer>
</section>
<dialog id="theme-dialog"><div class="dialog-title"><h2>让眼睛，也放松一下</h2><button class="icon-button" data-close="theme-dialog" aria-label="关闭主题设置">${i("x")}</button></div><p>选择适合此刻的阅读氛围。</p><div class="theme-options"><button data-theme-mode="auto">${i("monitor")}<strong>跟随时间</strong><span>昼夜自动切换</span></button><button data-theme-mode="light">${i("sun")}<strong>暖纸浅色</strong><span>柔和米白 · 鼠尾草绿</span></button><button data-theme-mode="dark">${i("moon")}<strong>静夜深色</strong><span>低亮度 · 柔和文字</span></button></div><div class="theme-schedule">${i("clock-3")} 自动模式：20:00–次日 07:00 使用深色，其余时间使用浅色。按设备本地时间切换。</div></dialog>
<dialog id="info-dialog"><div class="dialog-title"><h2>属于你的本地书架</h2><button class="icon-button" data-close="info-dialog" aria-label="关闭存储说明">${i("x")}</button></div><p>导入的书籍、进度和书签保存在当前浏览器中，不会自动上传整本书，也不会同步到其他设备。使用 GPT 翻译、解析或搜索时，选中的文字及追问会发送给 OpenAI。</p><p>请保留原始文件。清除网站数据、使用隐私浏览或更换浏览器后，本地书架可能丢失。支持未加密的 EPUB；PDF 可在打开时输入密码。</p></dialog>
<dialog id="delete-dialog"><div class="dialog-title"><h2>移除这本书？</h2></div><p id="delete-message"></p><div class="dialog-actions"><button class="secondary" data-close="delete-dialog">取消</button><button class="danger" id="confirm-delete">移除书籍</button></div></dialog>
<input type="file" id="file-input" accept=".pdf,.epub,application/pdf,application/epub+zip" multiple hidden>
<div id="toast" class="toast" role="status" aria-live="polite" hidden></div><div id="drag-overlay" hidden>${i("upload")}<h2>把好书，放进来。</h2><p>松开以导入 PDF 或 EPUB</p></div>`;
const $ = (s) => document.querySelector(s);
function icons() {
  createIcons({ icons: iconSet, attrs: { "stroke-width": 1.7 } });
}
window.addEventListener("zr-storage-blocked", () =>
  toast("请关闭其他旧版阅读器标签页，再刷新此页完成存储升级。原有书籍会保留。"),
);
let toastTimer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 5000);
}
const speechUI = createSpeechPanel({
  getReader: () => reader,
  icon: i,
  refreshIcons: icons,
  notify: toast,
});
createCloudPanel({ icon: i, refreshIcons: icons, importFiles, notify: toast });
const studyUI = createStudyPanel({
  icon: i,
  refreshIcons: icons,
  notify: toast,
  speechUI,
});
const zoteroUI = createZoteroPanel({
  getBooks: () => books,
  renderBooks,
  notify: toast,
  icon: i,
  refreshIcons: icons,
});
const annotationUI = createAnnotationPanel({
  getBook: () => active,
  getReader: () => reader,
  notify: toast,
  icon: i,
  refreshIcons: icons,
  onOpen() {
    studyUI.close();
    speechUI.close();
  },
  openZotero: () => zoteroUI.open(),
});
$("#speech-toggle").addEventListener("click", () => {
  studyUI.close();
  annotationUI.close();
});
$("#study-toggle").addEventListener("click", () => annotationUI.close());
document
  .querySelectorAll("[data-study-action],[data-study-tab]")
  .forEach((b) => b.addEventListener("click", () => annotationUI.close()));
function updateTheme() {
  const theme = resolvedTheme(themeMode);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content =
    theme === "dark" ? "#191e1b" : "#f6f5f0";
  $(".theme-label").innerHTML =
    `${i(theme === "dark" ? "moon" : "leaf")} ${themeMode === "auto" ? "自动护眼" : theme === "dark" ? "静夜深色" : "暖纸浅色"}`;
  document
    .querySelectorAll(".theme-open")
    .forEach((b) => (b.innerHTML = i(theme === "dark" ? "moon" : "sun")));
  document
    .querySelectorAll("[data-theme-mode]")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.themeMode === themeMode),
    );
  reader?.setTheme(theme);
  icons();
}
updateTheme();
setInterval(() => {
  if (resolvedTheme(themeMode) !== document.documentElement.dataset.theme)
    updateTheme();
}, 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) updateTheme();
});
document
  .querySelectorAll(".theme-open")
  .forEach((b) => (b.onclick = () => $("#theme-dialog").showModal()));
document.querySelectorAll("[data-theme-mode]").forEach(
  (b) =>
    (b.onclick = () => {
      themeMode = b.dataset.themeMode;
      savePreference("zr-theme", themeMode);
      updateTheme();
    }),
);
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => $(`#${b.dataset.close}`).close()));
document.querySelectorAll("dialog").forEach((d) =>
  d.addEventListener("click", (e) => {
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        d.close();
    }
  }),
);
$("#privacy").onclick = () => $("#info-dialog").showModal();
let format = "all";
function renderBooks() {
  $("#all-count").textContent = books.length;
  const names = { all: "我的书架", recent: "最近阅读", bookmarked: "我的书签" };
  $("#shelf-title").textContent = $("#crumb").textContent = names[filter];
  const selected = books
    .filter(
      (b) =>
        (filter !== "recent" || b.openedAt) &&
        (filter !== "bookmarked" || b.bookmarks?.length) &&
        zoteroUI.matches(b) &&
        (format === "all" || b.type === format) &&
        `${b.title} ${b.author}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.title.localeCompare(b.title, "zh-CN")
        : sort === "added"
          ? b.addedAt - a.addedAt
          : (b.openedAt || b.addedAt) - (a.openedAt || a.addedAt),
    );
  $("#book-count").textContent = `${selected.length} 本书`;
  $("#books").innerHTML = selected.length
    ? selected
        .map(
          (b) =>
            `<article class="book-card"><button class="book-open" data-open="${esc(b.id)}" aria-label="阅读 ${esc(b.title)}"><div class="book-cover palette-${b.color}"><span class="book-format">${b.type.toUpperCase()}</span><span class="book-cover-title">${esc(b.title)}</span><span class="book-cover-author">${esc(b.author || "私人藏书")}</span><div class="cover-decoration"></div><span class="book-cover-bottom">ZHEREADER / PERSONAL LIBRARY</span><span class="read-overlay">开始阅读 ${i("arrow-up-right")}</span></div><div class="book-info"><h3>${esc(b.title)}</h3><p>${esc(b.author || (b.type === "pdf" ? `${b.pages} 页 · PDF 文档` : "EPUB 电子书"))}</p><p class="book-collections">${esc(b.zotero?.collectionPaths?.join(" · ") || (b.zotero ? "Zotero 未分类" : ""))}</p><div class="book-progress"><span>${b.openedAt ? `已读 ${Math.round((b.progress || 0) * 100)}%` : "尚未开始"}${b.bookmarks?.length ? ` · ${b.bookmarks.length} 个书签` : ""}</span>${i("arrow-up-right")}</div><div class="progress-track"><span style="width:${Math.round((b.progress || 0) * 100)}%"></span></div></div></button><button class="remove-book icon-button" data-delete="${esc(b.id)}" aria-label="移除 ${esc(b.title)}">${i("trash-2")}</button></article>`,
        )
        .join("")
    : `<div class="empty-state">${i(query ? "search" : filter === "bookmarked" ? "bookmark" : "book-open")}<h3>${query ? "还没有找到这本书" : filter === "bookmarked" ? "把喜欢的地方，留个记号" : filter === "recent" ? "下一页，从这里开始" : format !== "all" ? `还没有 ${format.toUpperCase()} 书籍` : "你的书架，等一本好书"}</h3><p>${query ? "试试其他书名或作者关键词。" : filter === "bookmarked" ? "阅读时点击书签图标，即可收藏当前页。" : filter === "recent" ? "打开一本书后，阅读记录会出现在这里。" : "导入自己的藏书，或先探索上方的阅读体验。"}</p></div>`;
  document
    .querySelectorAll("[data-open]")
    .forEach((b) => (b.onclick = () => openBook(b.dataset.open)));
  document
    .querySelectorAll("[data-delete]")
    .forEach((b) => (b.onclick = () => askDelete(b.dataset.delete)));
  const last = books
    .filter((b) => b.openedAt)
    .sort((a, b) => b.openedAt - a.openedAt)[0];
  if (last) {
    $(".hero-copy").innerHTML =
      `<span class="hero-kicker"><span class="status-dot"></span> 接着上次的故事</span><h2 class="continue-title">${esc(last.title)}</h2><p>${esc(last.author || "你的私人藏书")}<br>已读 ${Math.round((last.progress || 0) * 100)}% · 阅读进度已保存</p><button class="hero-action" id="continue">继续阅读 ${i("arrow-right")}</button>`;
    $("#continue").onclick = () => openBook(last.id);
  } else {
    $(".hero-copy").innerHTML =
      `<span class="hero-kicker"><span class="status-dot"></span> 随时开始一段新的旅程</span><h2>世界很大，<br>也可以藏在一本书里。</h2><p>从你的第一本 PDF 或 EPUB 开始，<br>在这里，找到属于自己的阅读节奏。</p><button class="hero-action" id="demo">探索阅读体验 ${i("arrow-right")}</button>`;
    $("#demo").onclick = loadDemo;
  }
  icons();
}
document.querySelectorAll("[data-filter]").forEach(
  (b) =>
    (b.onclick = () => {
      filter = b.dataset.filter;
      document
        .querySelectorAll("[data-filter]")
        .forEach((n) => n.classList.toggle("selected", n === b));
      renderBooks();
    }),
);
document.querySelectorAll("[data-format]").forEach(
  (b) =>
    (b.onclick = () => {
      format = b.dataset.format;
      document
        .querySelectorAll("[data-format]")
        .forEach((n) => n.classList.toggle("active", n === b));
      renderBooks();
    }),
);
$("#search").oninput = (e) => {
  query = e.target.value;
  renderBooks();
};
$("#sort").onchange = (e) => {
  sort = e.target.value;
  renderBooks();
};
let deleteId;
function askDelete(id) {
  deleteId = id;
  $("#delete-message").textContent =
    `将从此浏览器移除《${books.find((b) => b.id === id).title}》及其阅读进度、书签和本地标注。未同步标注会丢失；原始文件及已同步到 Zotero 的标注保留。`;
  $("#delete-dialog").showModal();
}
$("#confirm-delete").onclick = async () => {
  try {
    await removeBook(deleteId);
    books = books.filter((b) => b.id !== deleteId);
    $("#delete-dialog").close();
    renderBooks();
    toast("已从书架移除");
  } catch {
    toast("移除失败，请重试");
  }
};
$("#import-top").onclick = $("#dropzone").onclick = () =>
  $("#file-input").click();
$("#file-input").onchange = async (e) => {
  await importFiles([...e.target.files]);
  e.target.value = "";
};
let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  if (e.dataTransfer.types.includes("Files")) {
    e.preventDefault();
    dragDepth++;
    $("#drag-overlay").hidden = false;
  }
});
document.addEventListener("dragover", (e) => {
  if (e.dataTransfer.types.includes("Files")) e.preventDefault();
});
document.addEventListener("dragleave", () => {
  dragDepth--;
  if (dragDepth <= 0) $("#drag-overlay").hidden = true;
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("#drag-overlay").hidden = true;
  if (!$("#reader-view").hidden) {
    toast("请先返回书架，再导入书籍");
    return;
  }
  importFiles([...e.dataTransfer.files]);
});
async function importFiles(files) {
  if (importing) {
    toast("正在导入，请稍候");
    return { success: 0, failures: ["正在导入，请稍候"] };
  }
  importing = true;
  $("#import-top").disabled = true;
  let success = 0;
  const failures = [];
  try {
    const { inspectBook } = await import("./reader");
    for (const file of files) {
      const type = file.name.split(".").pop().toLowerCase();
      if (!["pdf", "epub"].includes(type)) {
        failures.push(`${file.name}：仅支持 PDF 和 EPUB`);
        continue;
      }
      if (file.size > 250 * 1024 * 1024) {
        failures.push(`${file.name}：超过 250 MB`);
        continue;
      }
      toast(`正在导入 ${file.name}…`);
      try {
        const data = await file.arrayBuffer();
        const hash = await crypto.subtle.digest("SHA-256", data);
        const id = Array.from(new Uint8Array(hash), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        const existing = books.find((b) => b.id === id);
        if (existing) {
          if (file.cloudSource) {
            existing.cloudSource ||= file.cloudSource;
            zoteroUI.enrich(existing);
            await putBook({ ...existing });
          }
          failures.push(`${file.name}：已在书架中`);
          continue;
        }
        const meta = await inspectBook(data.slice(0), type);
        const book = {
          id,
          type,
          title: meta.title || file.name.replace(/\.(pdf|epub)$/i, ""),
          author: meta.author || "",
          pages: meta.pages || 0,
          color: books.length % 5,
          addedAt: Date.now(),
          progress: 0,
          bookmarks: [],
          filename: file.name,
          ...(file.cloudSource ? { cloudSource: file.cloudSource } : {}),
        };
        zoteroUI.enrich(book);
        await putBook(book, data);
        books.push(book);
        success++;
      } catch (error) {
        console.error("Book import failed:", error);
        failures.push(
          `${file.name}：${error.name === "QuotaExceededError" ? "浏览器存储空间不足" : "文件损坏、加密或格式不支持"}`,
        );
      }
    }
  } catch {
    failures.push("阅读组件加载失败，请刷新重试");
  } finally {
    importing = false;
    $("#import-top").disabled = false;
    renderBooks();
  }
  toast(
    [success ? `已导入 ${success} 本书` : "", ...failures]
      .filter(Boolean)
      .join("；") || "请选择 PDF 或 EPUB 文件",
  );
  return { success, failures };
}
async function loadDemo() {
  try {
    const existing = books.find((b) => b.filename === "慢读时光.epub");
    if (existing) return openBook(existing.id);
    const response = await fetch(`${import.meta.env.BASE_URL}sample.epub`);
    if (!response.ok) throw new Error("sample");
    await importFiles([
      new File([await response.blob()], "慢读时光.epub", {
        type: "application/epub+zip",
      }),
    ]);
    const book = books.find((b) => b.filename === "慢读时光.epub");
    if (book) await openBook(book.id);
  } catch {
    toast("示例暂时无法打开，请导入自己的书籍");
  }
}
let toc = [],
  showBookmarks = false;
async function openBook(id) {
  if (annotationUI.busy) {
    toast("正在保存或同步标注，请稍候。");
    return;
  }
  annotationUI.reset();
  speechUI.reset();
  studyUI.reset();
  studyUI.setReady(false);
  const token = ++openToken;
  active = books.find((b) => b.id === id);
  if (!active) return;
  $("#library-view").hidden = true;
  $("#reader-view").hidden = false;
  $("#reader-title").textContent = active.title;
  $("#reader-subtitle").textContent =
    `${active.type.toUpperCase()} · ${active.author || "私人藏书"}`;
  $("#reader-loading").hidden = false;
  $("#reader-loading").textContent = "正在打开书籍…";
  $("#toc-panel").hidden = true;
  toc = [];
  showBookmarks = false;
  renderToc();
  $("#pdf-container").hidden = active.type !== "pdf";
  $("#epub-container").hidden = active.type !== "epub";
  $("#pdf-jump").hidden = active.type !== "pdf";
  $("#epub-position").hidden = active.type !== "epub";
  $("#reader-progress").textContent = "准备阅读";
  try {
    const data = await getFile(id);
    const { Reader } = await import("./reader");
    if (token !== openToken) return;
    const current = active;
    reader = new Reader({
      book: current,
      data,
      fontSize,
      onSelection: (text, rect, annotation) => {
        if (token === openToken) {
          speechUI.selection(text);
          studyUI.selection(text, rect);
          annotationUI.selection(text, annotation);
        }
      },
      onProgress: async (position, progress, label) => {
        if (token !== openToken) return;
        current.position = position;
        current.progress = Math.max(0, Math.min(1, progress));
        current.openedAt = Date.now();
        $("#reader-progress").textContent =
          `已读 ${Math.round(current.progress * 100)}%`;
        $("#epub-position").textContent = label || "";
        if (current.type === "pdf") {
          $("#page-number").value = position;
          $("#page-total").textContent = `/ ${current.pages}`;
          $("#page-number").max = current.pages;
        }
        $("#prev-page").disabled = reader?.atStart ?? false;
        $("#next-page").disabled = reader?.atEnd ?? false;
        updateBookmarkButton();
        try {
          await putBook({ ...current });
        } catch {
          toast("进度保存失败，请检查浏览器存储空间");
        }
      },
      onToc: (entries) => {
        if (token === openToken) {
          toc = entries;
          renderToc();
        }
      },
      onError: (message) => toast(message),
    });
    await reader.open();
    if (token !== openToken) return;
    reader.setTheme(document.documentElement.dataset.theme);
    $("#size-label").textContent =
      active.type === "pdf" ? "100%" : `${fontSize}px`;
    $("#reader-loading").hidden = true;
    speechUI.setReady(true);
    studyUI.setReady(true);
    await annotationUI.load(current);
  } catch (error) {
    if (token !== openToken) return;
    $("#reader-loading").textContent =
      "无法打开这本书。请返回书架后重试，或检查文件是否完整、是否有 DRM 保护。";
    toast(error.message || "打开失败");
  }
}
$("#back").onclick = async () => {
  if (annotationUI.busy) {
    toast("正在保存或同步标注，请稍候。");
    return;
  }
  annotationUI.reset();
  speechUI.reset();
  studyUI.reset();
  studyUI.setReady(false);
  ++openToken;
  reader?.destroy();
  reader = null;
  active = null;
  if (document.fullscreenElement)
    await document.exitFullscreen().catch(() => {});
  $("#reader-view").hidden = true;
  $("#library-view").hidden = false;
  renderBooks();
};
function navigate(direction) {
  speechUI.selection("");
  studyUI.reset();
  reader?.turn(direction).catch((e) => toast(e.message || "翻页失败"));
}
$("#prev-page").onclick = () => navigate(-1);
$("#next-page").onclick = () => navigate(1);
$("#page-number").onchange = (e) => {
  speechUI.selection("");
  studyUI.reset();
  const page = Number(e.target.value);
  if (Number.isInteger(page) && page >= 1 && page <= active.pages)
    reader?.go(page).catch(() => toast("跳转失败"));
  else e.target.value = active.position || 1;
};
function resizeText(delta) {
  if (!reader) return;
  if (active.type === "epub") {
    fontSize = Math.max(14, Math.min(36, fontSize + delta * 2));
    savePreference("zr-font", fontSize);
    reader.setFontSize(fontSize);
    $("#size-label").textContent = `${fontSize}px`;
  } else {
    reader.zoom(delta);
    $("#size-label").textContent = `${Math.round(reader.scale * 100)}%`;
  }
}
$("#size-down").onclick = () => resizeText(-1);
$("#size-up").onclick = () => resizeText(1);
$("#fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $("#reader-view").requestFullscreen();
  } catch {
    toast("当前浏览器不支持全屏阅读");
  }
};
$("#toc-toggle").onclick = () => {
  $("#toc-panel").hidden = !$("#toc-panel").hidden;
};
$("#toc-close").onclick = () => ($("#toc-panel").hidden = true);
$("#chapters-tab").onclick = () => {
  showBookmarks = false;
  renderToc();
};
$("#bookmarks-tab").onclick = () => {
  showBookmarks = true;
  renderToc();
};
function renderToc() {
  $("#chapters-tab").classList.toggle("active", !showBookmarks);
  $("#bookmarks-tab").classList.toggle("active", showBookmarks);
  const entries = showBookmarks
    ? (active?.bookmarks || []).map((b) => ({
        label: b.label,
        target: b.position,
      }))
    : toc;
  $("#toc-list").innerHTML = entries.length
    ? entries
        .map(
          (entry, index) =>
            `<div class="toc-entry"><button data-toc="${index}" style="padding-left:${14 + (entry.depth || 0) * 12}px">${esc(entry.label)}</button>${showBookmarks ? `<button class="icon-button" data-remove-mark="${index}" aria-label="删除书签">${i("x")}</button>` : ""}</div>`,
        )
        .join("")
    : `<p class="toc-empty">${showBookmarks ? "还没有书签。点击顶部书签图标，记住这一页。" : "这本书没有提供目录。你可以使用底部按钮翻页。"}</p>`;
  document.querySelectorAll("[data-toc]").forEach(
    (b) =>
      (b.onclick = () => {
        speechUI.selection("");
        studyUI.reset();
        reader
          ?.go(entries[Number(b.dataset.toc)].target)
          .catch(() => toast("无法跳转到该位置"));
        if (window.innerWidth < 760) $("#toc-panel").hidden = true;
      }),
  );
  document.querySelectorAll("[data-remove-mark]").forEach(
    (b) =>
      (b.onclick = async () => {
        active.bookmarks.splice(Number(b.dataset.removeMark), 1);
        try {
          await putBook({ ...active });
          renderToc();
          updateBookmarkButton();
        } catch {
          toast("保存书签失败");
        }
      }),
  );
  icons();
}
function updateBookmarkButton() {
  $("#add-bookmark").classList.toggle(
    "bookmarked",
    !!active?.bookmarks?.some((b) => b.position === active.position),
  );
}
$("#add-bookmark").onclick = async () => {
  if (!active?.position) return;
  active.bookmarks ||= [];
  const existing = active.bookmarks.findIndex(
    (b) => b.position === active.position,
  );
  if (existing >= 0) active.bookmarks.splice(existing, 1);
  else
    active.bookmarks.push({
      position: active.position,
      label:
        active.type === "pdf"
          ? `第 ${active.position} 页`
          : `${$("#epub-position").textContent || "阅读位置"} · ${Math.round(active.progress * 100)}%`,
      addedAt: Date.now(),
    });
  try {
    await putBook({ ...active });
    updateBookmarkButton();
    if (showBookmarks) renderToc();
    toast(existing >= 0 ? "已取消书签" : "已记住这一页");
  } catch {
    toast("保存书签失败");
  }
};
document.addEventListener("keydown", (e) => {
  if (
    document.querySelector("dialog[open]") ||
    /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)
  )
    return;
  if (active) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      navigate(-1);
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      navigate(1);
    }
  } else if (e.key === "/") {
    e.preventDefault();
    $("#search").focus();
  }
});
try {
  await zoteroUI.ready;
  books = await listBooks();
  renderBooks();
} catch {
  renderBooks();
  toast("无法访问本地书架，请允许浏览器使用网站存储后刷新");
}
