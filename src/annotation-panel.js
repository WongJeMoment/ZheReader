import { StudyBridge } from "./study-bridge";
import { annotationColors, validateAnnotation } from "../shared/annotations";
import { listAnnotations, putAnnotation, removeAnnotation } from "./storage";
export function createAnnotationPanel({
  getBook,
  getReader,
  notify,
  icon,
  refreshIcons,
  onOpen,
  openZotero,
}) {
  const bridge = new StudyBridge(),
    $ = (id) => document.getElementById(id);
  const panel = document.createElement("aside");
  panel.id = "annotation-panel";
  panel.className = "annotation-panel";
  panel.hidden = true;
  panel.innerHTML = `<div class="study-heading"><div><span class="eyebrow">MAKE IT YOURS</span><h2>论文标注</h2></div><button id="annotation-close" class="icon-button" aria-label="关闭标注面板">${icon("x")}</button></div><p id="annotation-binding" class="cloud-hint"></p><div class="annotation-tools"><button id="annotation-zotero" class="text-button">连接与分类设置</button><button id="annotation-sync" class="primary">同步到 Zotero</button></div><p id="annotation-status" role="status">框选 PDF 文字，保存高亮或下划线。</p><form id="annotation-form"><blockquote id="annotation-quote"></blockquote><label>标注类型<select id="annotation-type"><option value="highlight">高亮</option><option value="underline">下划线</option></select></label><label>颜色<select id="annotation-color">${annotationColors.map((color, i) => `<option value="${color}">${["黄色", "红色", "绿色", "蓝色", "紫色", "洋红", "橙色", "灰色"][i]}</option>`).join("")}</select></label><label class="annotation-comment-label">评论<textarea id="annotation-comment" maxlength="8000" rows="3" placeholder="记下你的理解、问题或想法…"></textarea></label><button id="annotation-save" class="secondary" type="submit" disabled>保存标注</button><button id="annotation-new" class="text-button" type="button">取消编辑</button></form><div id="annotation-list"></div>`;
  document.querySelector(".reader-body").append(panel);
  const quick = document.createElement("button");
  quick.id = "annotate-selection";
  quick.className = "secondary annotate-selection";
  quick.hidden = true;
  quick.innerHTML = icon("highlighter") + " 标注选中文字";
  $("reading-stage").append(quick);
  let bookId = "",
    records = [],
    selection = null,
    editing = null,
    busy = false,
    generation = 0;
  function selectedKey() {
    const alphabet = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
    return Array.from(
      crypto.getRandomValues(new Uint8Array(8)),
      (n) => alphabet[n % alphabet.length],
    ).join("");
  }
  function status(text) {
    $("annotation-status").textContent = text;
  }
  function clearEditor() {
    editing = null;
    selection = null;
    $("annotation-quote").textContent = "在 PDF 中选择文字后开始标注。";
    $("annotation-comment").value = "";
    $("annotation-save").disabled = true;
    quick.hidden = true;
  }
  function paint() {
    getReader()?.setAnnotations(
      records.filter((r) => !r.deleted).map((r) => r.annotation),
    );
  }
  function show() {
    if (getBook()?.type !== "pdf") {
      notify("当前标注功能支持 PDF 论文。");
      return;
    }
    onOpen();
    panel.hidden = false;
    $("annotation-toggle").setAttribute("aria-expanded", "true");
    quick.hidden = true;
    render();
  }
  function controls() {
    for (const id of [
      "annotation-sync",
      "annotation-new",
      "annotation-color",
      "annotation-type",
      "annotation-comment",
    ])
      $(id).disabled = busy;
    $("annotation-save").disabled = busy || !selection;
  }
  function render() {
    const book = getBook();
    $("annotation-binding").textContent = book?.zotero
      ? "已关联 Zotero 附件 " + book.zotero.attachmentKey
      : "尚未关联 Zotero。可先离线标注，再连接 Zotero 刷新分类。";
    const list = $("annotation-list");
    list.replaceChildren();
    const pending = records.filter((r) => r.pending).length;
    $("annotation-sync").textContent = pending
      ? `同步到 Zotero（${pending}）`
      : "同步到 Zotero";
    for (const record of records) {
      const card = document.createElement("article");
      card.className = "annotation-card";
      card.style.borderLeftColor = record.annotation.color;
      const quote = document.createElement("blockquote");
      quote.textContent = record.annotation.text;
      const comment = document.createElement("p");
      comment.textContent = record.annotation.comment;
      const meta = document.createElement("small");
      meta.textContent = `第 ${record.annotation.pageLabel} 页 · ${record.deleted ? "待同步删除" : record.pending ? "待同步" : "已同步"}${record.error ? " · " + record.error : ""}`;
      const actions = document.createElement("div");
      actions.className = "annotation-card-actions";
      for (const [label, callback] of [
        [
          "定位",
          () => getReader()?.go(record.annotation.position.pageIndex + 1),
        ],
        [
          "编辑",
          () => {
            editing = record;
            selection = structuredClone(record.annotation);
            $("annotation-quote").textContent = selection.text;
            $("annotation-comment").value = selection.comment;
            $("annotation-color").value = selection.color;
            $("annotation-type").value = selection.type;
            controls();
          },
        ],
        ["删除", () => remove(record)],
        ...(record.error ? [["采用 Zotero 版本", () => adopt(record)]] : []),
      ]) {
        if (record.deleted && ["编辑", "删除"].includes(label)) continue;
        const b = document.createElement("button");
        b.className = "text-button";
        b.textContent = label;
        b.disabled = busy;
        b.onclick = callback;
        actions.append(b);
      }
      card.append(quote, comment, meta, actions);
      list.append(card);
    }
    if (!records.length) {
      const p = document.createElement("p");
      p.className = "study-empty";
      p.textContent = "高亮关键句，留住你的想法。";
      list.append(p);
    }
    controls();
  }
  async function persist(record) {
    await putAnnotation(record);
    const index = records.findIndex((r) => r.id === record.id);
    if (index < 0) records.push(record);
    else records[index] = record;
    paint();
    render();
  }
  async function remove(record) {
    if (busy) return;
    busy = true;
    render();
    try {
      if (record.target || record.base) {
        await persist({ ...record, deleted: true, pending: true, error: "" });
        status("已标记删除，点击同步后从 Zotero 删除。");
      } else {
        await removeAnnotation(record.id);
        records = records.filter((r) => r.id !== record.id);
        paint();
        render();
      }
      if (editing?.id === record.id) clearEditor();
    } catch (e) {
      status(e.message);
    } finally {
      busy = false;
      render();
    }
  }
  function payload(record, book) {
    return {
      instance: book.zotero.instance,
      attachmentKey: book.zotero.attachmentKey,
      fileHash: book.id,
      key: record.annotation.key,
      annotation: record.annotation,
      deleted: !!record.deleted,
      base: record.base || null,
    };
  }
  async function adopt(record) {
    if (busy || !getBook()?.zotero) return;
    busy = true;
    render();
    try {
      const book = getBook();
      if (
        record.target &&
        record.target !== `${book.zotero.instance}:${book.zotero.attachmentKey}`
      )
        throw new Error("此标注属于另一文库，不能采用当前文库版本。");
      const r = await bridge.request("zotero/read", {
        body: payload(record, getBook()),
      });
      if (r.annotation) {
        await persist({
          ...record,
          annotation: validateAnnotation(r.annotation),
          base: r.base,
          pending: false,
          deleted: false,
          error: "",
        });
      } else {
        await removeAnnotation(record.id);
        records = records.filter((a) => a.id !== record.id);
        paint();
      }
      clearEditor();
      status("已采用 Zotero 版本。");
    } catch (e) {
      status(e.message);
    } finally {
      busy = false;
      render();
    }
  }
  $("annotation-sync").onclick = async () => {
    const book = getBook();
    if (busy) return;
    if (!book?.zotero) {
      status("请先连接 Zotero 并刷新分类，将这篇 PDF 关联到附件。");
      return;
    }
    const target = `${book.zotero.instance}:${book.zotero.attachmentKey}`;
    busy = true;
    render();
    let done = 0,
      failed = 0;
    try {
      for (const record of records.filter((r) => r.pending)) {
        status(`正在同步第 ${done + failed + 1} 条标注…`);
        try {
          if (record.target && record.target !== target)
            throw new Error("此标注属于另一个 Zotero 文库关联，未回传。");
          record.target = target;
          await putAnnotation(record);
          const response = await bridge.request("zotero/sync", {
            body: payload(record, book),
          });
          if (response.deleted) {
            await removeAnnotation(record.id);
            records = records.filter((r) => r.id !== record.id);
          } else
            await persist({
              ...record,
              base: response.base,
              pending: false,
              error: "",
            });
          done++;
        } catch (e) {
          await persist({ ...record, error: e.message, pending: true });
          failed++;
        }
      }
      status(
        `已同步 ${done} 条${failed ? `，${failed} 条保留待同步，请查看错误信息` : ""}。`,
      );
    } catch (e) {
      status(e.message);
    } finally {
      busy = false;
      paint();
      render();
    }
  };
  $("annotation-form").onsubmit = async (e) => {
    e.preventDefault();
    if (busy || !selection || !getBook()) return;
    busy = true;
    render();
    try {
      const a = validateAnnotation({
        ...selection,
        key: editing?.annotation.key || selectedKey(),
        color: $("annotation-color").value,
        type: $("annotation-type").value,
        comment: $("annotation-comment").value,
      });
      const record = {
        ...(editing || {}),
        id: `${bookId}:${a.key}`,
        bookId,
        annotation: a,
        pending: true,
        deleted: false,
        error: "",
      };
      await persist(record);
      clearEditor();
      status("已保存到浏览器，点击「同步到 Zotero」回传。");
    } catch (error) {
      status(error.message);
    } finally {
      busy = false;
      render();
    }
  };
  $("annotation-new").onclick = clearEditor;
  $("annotation-zotero").onclick = openZotero;
  $("annotation-toggle").onclick = () => {
    if (panel.hidden) show();
    else {
      panel.hidden = true;
      $("annotation-toggle").setAttribute("aria-expanded", "false");
    }
  };
  quick.onclick = show;
  $("annotation-close").onclick = () => {
    panel.hidden = true;
    $("annotation-toggle").setAttribute("aria-expanded", "false");
  };
  refreshIcons();
  return {
    async load(book) {
      const current = ++generation;
      bookId = book.id;
      records = [];
      clearEditor();
      const data = await listAnnotations(book.id);
      if (current !== generation) return;
      records = data;
      render();
      paint();
    },
    selection(text, a) {
      if (busy) return;
      if (!text || !a) {
        if (!editing) clearEditor();
        return;
      }
      editing = null;
      selection = {
        ...a,
        text,
        type: "highlight",
        color: $("annotation-color").value,
        comment: "",
      };
      $("annotation-quote").textContent = text;
      $("annotation-comment").value = "";
      quick.hidden = false;
      controls();
    },
    reset() {
      if (busy) return false;
      generation++;
      bookId = "";
      records = [];
      clearEditor();
      panel.hidden = true;
      return true;
    },
    close() {
      panel.hidden = true;
      quick.hidden = true;
    },
    get busy() {
      return busy;
    },
  };
}
