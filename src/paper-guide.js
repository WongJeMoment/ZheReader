import { StudyBridge } from "./study-bridge";
import { getSetting, putSetting } from "./storage";
import { validateGuide } from "../shared/paper-guide";
export function createPaperGuide({ getBook, getReader, onOpen, notify }) {
  const bridge = new StudyBridge();
  const panel = document.createElement("aside");
  panel.id = "paper-guide";
  panel.className = "paper-guide";
  panel.hidden = true;
  panel.innerHTML = `<div class="dialog-title"><h2>GPT 带读论文</h2><button id="guide-close" class="icon-button" aria-label="关闭论文带读">×</button></div><p>先补基础，再逐段读懂。每条讲解都有原文可核对。</p><button id="guide-account" class="text-button">账号与模型设置</button><label for="guide-background">你的基础与阅读目标</label><textarea id="guide-background" maxlength="1000" rows="2" placeholder="例如：熟悉 Python，不懂强化学习；想复现方法"></textarea><div class="guide-controls"><button id="guide-plan" class="primary">生成阅读准备</button><button id="guide-plan-view" class="text-button">查看已保存的准备</button><button id="guide-read" class="secondary">精读这一段</button><button id="guide-stop" class="text-button" hidden>停止</button></div><p id="guide-status" role="status"></p><p class="guide-note">阅读准备使用全文抽样，不代表已精读全文；逐段精读覆盖提取到的正文。图表、公式需结合原页核对。点击生成会将相应原文发送给 GPT，使用当前账号与模型的 Codex 额度。</p><div class="guide-navigation"><button id="guide-prev" class="secondary">上一段</button><span id="guide-position"></span><button id="guide-next" class="secondary">下一段</button></div><details><summary>当前原文</summary><p id="guide-source"></p><button id="guide-locate" class="text-button">打开对应原页</button></details><div id="guide-result"></div><form id="guide-question-form"><label for="guide-question">就这一段追问</label><input id="guide-question" maxlength="450" placeholder="例如：这个假设为什么必要？"><button class="secondary">继续讲解</button></form>`;
  document.querySelector(".reader-body").append(panel);
  const $ = (id) => panel.querySelector("#" + id);
  let units = [],
    index = 0,
    state = { results: {} },
    controller,
    generation = 0,
    bookId = "",
    busy = false;
  const status = (t) => ($("guide-status").textContent = t);
  function controls() {
    for (const id of ["guide-plan", "guide-read", "guide-prev", "guide-next"])
      $(id).disabled = busy || !units.length;
    $("guide-prev").disabled ||= index === 0;
    $("guide-next").disabled ||= index >= units.length - 1;
    $("guide-question-form").querySelector("button").disabled =
      busy || !units.length;
    $("guide-plan-view").disabled = busy || !state.plan;
    $("guide-background").disabled = busy;
    $("guide-stop").hidden = !busy;
  }
  function textNode(parent, tag, text) {
    const el = document.createElement(tag);
    el.textContent = text;
    parent.append(el);
    return el;
  }
  async function locate(source) {
    if (getBook()?.id !== bookId) return;
    try {
      await getReader().go(source.page);
    } catch (e) {
      notify(e.message);
    }
  }
  function show(result, sources) {
    const out = $("guide-result");
    out.replaceChildren();
    if (!result) return;
    textNode(out, "h3", result.title);
    textNode(out, "p", result.summary);
    for (const row of [...result.prerequisites, ...result.explanations]) {
      const card = document.createElement("section");
      card.className = "guide-explanation";
      out.append(card);
      textNode(card, "h4", row.topic || `${row.kind} · ${row.heading}`);
      if (row.topic) {
        textNode(card, "p", "为什么先学：" + row.why);
        textNode(card, "p", "先读什么：" + row.study);
        textNode(card, "p", "自测：" + row.checkpoint);
      } else textNode(card, "p", row.explanation);
      textNode(card, "blockquote", row.quote);
      const source = sources.find((s) => s.id === row.sourceId);
      const link = textNode(
        card,
        "button",
        `原文第 ${source.page} 页 · ${source.id} ↗`,
      );
      link.className = "text-button";
      link.onclick = () => locate(source);
    }
    if (result.questions.length) {
      textNode(out, "h4", "检查是否读懂");
      for (const q of result.questions) textNode(out, "p", q);
    }
    if (result.model) textNode(out, "small", "解读模型：" + result.model);
  }
  function position() {
    $("guide-position").textContent = units.length
      ? `${index + 1} / ${units.length} 段 · 第 ${units[index].page} 页`
      : "";
    $("guide-source").textContent = units[index]?.text || "";
    const saved = state.results[units[index]?.id];
    if (saved) {
      try {
        show(validateGuide(saved, JSON.stringify([units[index]])), [
          units[index],
        ]);
      } catch {
        show(null);
      }
    } else show(null);
    controls();
  }
  async function persist() {
    await putSetting("paper-guide:" + bookId, {
      ...state,
      index,
      background: $("guide-background").value,
    });
  }
  async function open() {
    onOpen();
    panel.hidden = false;
    if (bookId === getBook()?.id && units.length) return;
    reset(false);
    bookId = getBook()?.id || "";
    const reader = getReader();
    if (!reader?.pdf) {
      status("目前支持 PDF 论文带读；请先打开 PDF。");
      controls();
      return;
    }
    controller = new AbortController();
    const token = ++generation;
    busy = true;
    controls();
    status("正在本地提取论文正文…");
    try {
      const saved = await getSetting("paper-guide:" + bookId);
      if (token !== generation) return;
      state = saved?.results ? saved : { results: {} };
      $("guide-background").value = state.background || "";
      let page = 0,
        total = 0,
        empty = 0;
      for await (const section of reader.speechSections({
        signal: controller.signal,
      })) {
        if (token !== generation) return;
        page++;
        if (!section.text.trim()) {
          empty++;
          continue;
        }
        total += section.text.length;
        if (total > 1500000)
          throw new Error("论文正文超过当前带读上限，请拆分 PDF 后阅读。");
        let remaining = section.text,
          part = 0;
        while (remaining) {
          let end = Math.min(2800, remaining.length);
          const boundary = remaining.lastIndexOf("\n", end);
          if (boundary > 1400) end = boundary + 1;
          units.push({
            id: `p${page}-s${++part}`,
            page,
            text: remaining.slice(0, end),
          });
          remaining = remaining.slice(end);
        }
        status(`已提取 ${page} 页…`);
      }
      if (token !== generation) return;
      controller.signal.throwIfAborted();
      if (!units.length)
        throw new Error("没有可提取的正文，请先对扫描件进行 OCR。");
      index = Math.min(state.index || 0, units.length - 1);
      position();
      status(
        `正文已就绪，共 ${units.length} 段。${empty ? `${empty} 页无文本，未纳入带读。` : ""}先生成阅读准备，或从当前段开始。`,
      );
      if (state.plan && !state.results[units[index].id]) {
        try {
          show(
            validateGuide(
              state.plan.result,
              JSON.stringify(state.plan.sources),
            ),
            state.plan.sources,
          );
        } catch {
          state.plan = null;
        }
      }
    } catch (e) {
      if (token === generation) {
        units = [];
        status(e.message);
      }
    } finally {
      if (token === generation) {
        busy = false;
        controls();
      }
    }
  }
  function overview() {
    const count = Math.min(10, units.length),
      result = [];
    for (let n = 0; n < count; n++) {
      const unit =
        units[Math.round((n * (units.length - 1)) / Math.max(1, count - 1))];
      result.push({ ...unit, text: unit.text.slice(0, 600) });
    }
    return result;
  }
  async function run(action, question = "") {
    if (busy || !units.length) return;
    busy = true;
    controller = new AbortController();
    const token = ++generation;
    controls();
    const sources = action === "paper-plan" ? overview() : [units[index]];
    status(
      action === "paper-plan"
        ? `正在根据 ${sources.length} 个抽样片段制定准备路线…`
        : "正在逐段解读并核对原文引用…",
    );
    try {
      let model = "";
      try {
        model = localStorage.getItem("zr-study-model") || "";
      } catch {}
      const result = await bridge.request("study", {
        signal: controller.signal,
        body: {
          action,
          text: JSON.stringify(sources),
          question: [$("guide-background").value, question]
            .filter(Boolean)
            .join("\n"),
          translation: state.plan?.result.summary?.slice(0, 2000) || "",
          model,
        },
      });
      if (token !== generation) return;
      validateGuide(result, JSON.stringify(sources));
      if (action === "paper-plan") state.plan = { result, sources };
      else state.results[units[index].id] = result;
      show(result, sources);
      await persist();
      if (token === generation)
        status("已完成，引用已核对。可点击页码对照原文；解读仍需自行判断。");
    } catch (e) {
      if (token === generation)
        status(e.name === "AbortError" ? "已停止，可重新生成。" : e.message);
    } finally {
      if (token === generation) {
        busy = false;
        controls();
      }
    }
  }
  function reset(hide = true) {
    generation++;
    controller?.abort();
    busy = false;
    units = [];
    bookId = "";
    index = 0;
    state = { results: {} };
    show(null);
    $("guide-source").textContent = "";
    $("guide-position").textContent = "";
    $("guide-question").value = "";
    if (hide) panel.hidden = true;
    controls();
  }
  $("guide-close").onclick = () => {
    panel.hidden = true;
  };
  $("guide-account").onclick = () =>
    document.querySelector(".account-open").click();
  $("guide-plan").onclick = () => run("paper-plan");
  $("guide-plan-view").onclick = () => {
    try {
      show(
        validateGuide(state.plan.result, JSON.stringify(state.plan.sources)),
        state.plan.sources,
      );
      status("已加载保存的阅读准备，未调用 GPT。");
    } catch (e) {
      status(e.message);
    }
  };
  $("guide-read").onclick = () => run("paper-read");
  $("guide-stop").onclick = () => controller?.abort();
  $("guide-locate").onclick = () => units[index] && locate(units[index]);
  for (const [id, delta] of [
    ["guide-prev", -1],
    ["guide-next", 1],
  ])
    $(id).onclick = () => {
      index += delta;
      position();
      persist().catch((e) => status(e.message));
    };
  $("guide-question-form").onsubmit = (e) => {
    e.preventDefault();
    if ($("guide-question").value.trim())
      run("paper-read", $("guide-question").value.trim());
  };
  document.getElementById("guide-toggle").onclick = open;
  controls();
  return {
    reset,
    close() {
      panel.hidden = true;
    },
  };
}
