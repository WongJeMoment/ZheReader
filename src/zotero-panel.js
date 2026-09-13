import { StudyBridge } from "./study-bridge";
import { collectionPaths, inCollection } from "../shared/annotations";
import { getSetting, putSetting, putBook } from "./storage";
export function createZoteroPanel({
  getBooks,
  renderBooks,
  notify,
  icon,
  refreshIcons,
}) {
  const bridge = new StudyBridge();
  let catalog = { instance: "", collections: [], attachments: [] },
    selected = "";
  const $ = (id) => document.getElementById(id);
  const dialog = document.createElement("dialog");
  dialog.id = "zotero-dialog";
  dialog.innerHTML = `<div class="dialog-title"><h2>Zotero 分类与标注</h2><button id="zotero-close" class="icon-button" aria-label="关闭 Zotero 设置">${icon("x")}</button></div><p>连接本机 Zotero，按原有分类整理论文，并回传原生 PDF 高亮、下划线和评论。</p><ol class="zotero-steps"><li><a id="zotero-addon-download" download href="${import.meta.env.BASE_URL}downloads/zhereader-zotero.xpi">下载 ZheReader Zotero 插件</a>（1.0.2，适配 Zotero 9，支持标签）。</li><li>在 Zotero「工具 → 插件」中，点击齿轮菜单「从文件安装插件」，选择下载的 XPI。</li><li>保持 Zotero 开启，连接本机服务后，点击下方「连接 Zotero」，并在 Zotero 窗口确认授权。</li></ol><div class="zotero-buttons"><button id="zotero-pair-bridge" class="secondary">连接本机服务</button><button id="zotero-connect" class="primary">连接 Zotero</button><button id="zotero-refresh" class="secondary">刷新分类与关联</button></div><p id="zotero-status" role="status"></p><p class="cloud-hint">分类来自 Zotero「我的文库」。通过坚果云导入的附件会按附件编号关联；既有论文也可以刷新关联。标注先保存在浏览器，点击「同步到 Zotero」后回传；关闭 Zotero 时可继续离线标注。</p>`;
  document.body.append(dialog);
  function enrich(book) {
    const key = book.cloudSource?.path
      ?.match(/\/([A-Z0-9]{8})\.zip$/i)?.[1]
      ?.toUpperCase();
    const attachment = catalog.attachments.find((a) => a.key === key);
    if (!attachment) {
      if (book.zotero?.instance === catalog.instance) delete book.zotero;
      return book;
    }
    const paths = collectionPaths(catalog.collections);
    book.zotero = {
      instance: catalog.instance,
      attachmentKey: attachment.key,
      parentKey: attachment.parentKey,
      tags: attachment.tags || [],
      collections: attachment.collections,
      collectionPaths: attachment.collections
        .map((k) => paths.find((c) => c.key === k)?.path)
        .filter(Boolean),
    };
    if (attachment.title) book.title = attachment.title;
    return book;
  }
  function render() {
    const container = $("zotero-collections");
    container.replaceChildren();
    if (!catalog.collections.length) return;
    const label = document.createElement("p");
    label.className = "workspace-label";
    label.textContent = "ZOTERO 分类";
    container.append(label);
    for (const c of [
      { key: "", name: "全部分类", path: "全部分类" },
      ...collectionPaths(catalog.collections).sort((a, b) =>
        a.path.localeCompare(b.path),
      ),
    ]) {
      const button = document.createElement("button");
      button.className =
        "nav-item zotero-collection" + (selected === c.key ? " selected" : "");
      button.textContent = c.name;
      button.title = c.path;
      button.style.paddingLeft = `${14 + Math.min(4, c.path.split(" / ").length - 1) * 12}px`;
      button.dataset.collection = c.key;
      button.onclick = () => {
        selected = c.key;
        render();
        renderBooks();
      };
      container.append(button);
    }
  }
  async function refresh() {
    $("zotero-status").textContent = "正在读取 Zotero 分类并关联已导入论文…";
    const next = await bridge.request("zotero/catalog", { body: {} });
    if (!Array.isArray(next.collections) || !Array.isArray(next.attachments))
      throw new Error("Zotero 分类数据无效。");
    catalog = next;
    await putSetting("zotero-catalog", catalog);
    let count = 0;
    for (const book of getBooks()) {
      const before = JSON.stringify([book.zotero, book.title]);
      enrich(book);
      if (book.zotero?.instance === catalog.instance) count++;
      if (JSON.stringify([book.zotero, book.title]) !== before)
        await putBook({ ...book });
    }
    if (selected && !catalog.collections.some((c) => c.key === selected))
      selected = "";
    render();
    renderBooks();
    $("zotero-status").textContent =
      `已读取 ${catalog.collections.length} 个分类，关联 ${count} 篇已导入论文。新导入附件将自动归类。` +
      (next.attachments.some((a) => !Array.isArray(a.tags))
        ? " 标签读取需要安装 1.0.2 或更新的配套插件。"
        : "标签已更新，可在书架按标签查找。");
  }
  async function run(fn) {
    for (const id of ["zotero-connect", "zotero-refresh", "zotero-pair-bridge"])
      $(id).disabled = true;
    try {
      await fn();
    } catch (e) {
      $("zotero-status").textContent = e.message;
    } finally {
      for (const id of [
        "zotero-connect",
        "zotero-refresh",
        "zotero-pair-bridge",
      ])
        $(id).disabled = false;
    }
  }
  function open() {
    dialog.showModal();
  }
  $("zotero-open").onclick = open;
  $("zotero-close").onclick = () => dialog.close();
  $("zotero-pair-bridge").onclick = () =>
    run(async () => {
      await bridge.connect();
      $("zotero-status").textContent = "本机服务已连接，请连接 Zotero。";
    });
  $("zotero-connect").onclick = () =>
    run(async () => {
      $("zotero-status").textContent =
        "请在 Zotero 窗口确认 ZheReader 连接请求…";
      await bridge.request("zotero/pair", { body: {} });
      await refresh();
    });
  $("zotero-refresh").onclick = () => run(refresh);
  const ready = getSetting("zotero-catalog")
    .then((value) => {
      if (value) {
        catalog = value;
        render();
      }
    })
    .catch(() => {});
  refreshIcons();
  return {
    ready,
    enrich,
    open,
    matches(book) {
      return (
        !selected ||
        (book.zotero?.instance === catalog.instance &&
          inCollection(book.zotero.collections, selected, catalog.collections))
      );
    },
  };
}
