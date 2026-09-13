import { extractPaperText } from "./paper-text";
import { StudyBridge } from "./study-bridge";
import { getSetting, putSetting } from "./storage";
import { validateGuide, GUIDE_PROMPT_VERSION } from "../shared/paper-guide";
export function createPaperGuide({ getBook, getReader, onOpen, notify }) {
  const bridge = new StudyBridge();
  const panel = document.createElement("aside");
  panel.id = "paper-guide";
  panel.className = "paper-guide";
  panel.hidden = true;
  panel.innerHTML = `<div class="dialog-title"><h2>GPT 带读论文</h2><button id="guide-close" class="icon-button" aria-label="关闭论文带读">×</button></div><p>先补基础，再逐段读懂。每条讲解都有原文可核对。</p><button id="guide-account" class="text-button">账号与模型设置</button><label for="guide-background">你的基础与阅读目标</label><textarea id="guide-background" maxlength="1000" rows="2" placeholder="例如：熟悉 Python，不懂强化学习；想复现方法"></textarea><label for="guide-depth">讲解方式</label><select id="guide-depth"><option value="quick">快速带读 · 先看重点</option><option value="detailed">深入讲解 · 展开细节</option></select><label class="guide-prefetch-option"><input id="guide-prefetch" type="checkbox" checked>提前准备下一段（会使用账号额度）</label><p id="guide-prefetch-status" role="status"></p><div class="guide-controls"><button id="guide-plan" class="primary">生成阅读准备</button><button id="guide-plan-view" class="text-button">查看已保存的准备</button><button id="guide-read" class="secondary">精读这一段</button><button id="guide-regenerate" class="text-button">重新生成</button><button id="guide-stop" class="text-button" hidden>停止</button></div><p id="guide-status" role="status"></p><p class="guide-note">阅读准备使用全文抽样，不代表已精读全文；逐段精读覆盖提取到的正文。图表、公式需结合原页核对。点击生成会将相应原文发送给 GPT，使用当前账号与模型的 Codex 额度。</p><div class="guide-navigation"><button id="guide-prev" class="secondary">上一段</button><span id="guide-position"></span><button id="guide-next" class="secondary">下一段</button></div><details><summary>当前原文</summary><p id="guide-source"></p><button id="guide-locate" class="text-button">打开对应原页</button></details><div id="guide-result"></div><form id="guide-question-form"><label for="guide-question">就这一段追问</label><input id="guide-question" maxlength="450" placeholder="例如：这个假设为什么必要？"><button class="secondary">继续讲解</button></form>`;
  document.querySelector(".reader-body").append(panel);
  const $ = (id) => panel.querySelector("#" + id);
  let units = [],
    index = 0,
    state = { results: {} },
    controller,
    generation = 0,
    bookId = "",
    busy = false,
    session = 0,
    autoReading = false;
  const tasks = new Map();
  const status = (t) => ($("guide-status").textContent = t);
  function controls() {
    for (const id of ["guide-plan", "guide-read", "guide-prev", "guide-next"])
      $(id).disabled = busy || !units.length;
    $("guide-prev").disabled ||= index === 0;
    $("guide-next").disabled ||= index >= units.length - 1;
    $("guide-question-form").querySelector("button").disabled =
      busy || !units.length;
    $("guide-plan-view").disabled = busy || !state.plan;
    $("guide-depth").disabled = busy;
    $("guide-regenerate").disabled = busy || !units.length;
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
    if (
      saved &&
      (!saved._context ||
        saved._context === requestKey("paper-read", [units[index]]))
    ) {
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
      depth: $("guide-depth").value,
      prefetch: $("guide-prefetch").checked,
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
      $("guide-depth").value = state.depth || "quick";
      $("guide-prefetch").checked = state.prefetch !== false;
      let extracted = await getSetting("paper-text:" + bookId);
      if (token !== generation) return;
      const reused =
        extracted?.version === 1 &&
        Array.isArray(extracted.units) &&
        extracted.units.length;
      if (!reused) {
        extracted = await extractPaperText(
          reader.pdf,
          controller.signal,
          (done, total) => {
            if (token === generation)
              status(`正在提取正文 ${done} / ${total} 页…`);
          },
        );
        if (token !== generation) return;
        await putSetting("paper-text:" + bookId, extracted);
      }
      if (token !== generation) return;
      units = extracted.units;
      const empty = extracted.empty;
      if (token !== generation) return;
      controller.signal.throwIfAborted();
      if (!units.length)
        throw new Error("没有可提取的正文，请先对扫描件进行 OCR。");
      index = Math.min(state.index || 0, units.length - 1);
      position();
      status(
        `正文已就绪${reused ? "（已复用缓存）" : ""}，共 ${units.length} 段。${empty ? `${empty} 页无文本，未纳入带读。` : ""}先生成阅读准备，或从当前段开始。`,
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
    const quick = $("guide-depth").value === "quick";
    const count = Math.min(quick ? 6 : 10, units.length),
      result = [];
    for (let n = 0; n < count; n++) {
      const unit =
        units[Math.round((n * (units.length - 1)) / Math.max(1, count - 1))];
      result.push({ ...unit, text: unit.text.slice(0, quick ? 400 : 600) });
    }
    return result;
  }
  function requestBody(action, sources, question = "") {
    let model = "";
    try {
      model = localStorage.getItem("zr-study-model") || "";
    } catch {}
    return {
      action,
      text: JSON.stringify(sources),
      question: [$("guide-background").value, question]
        .filter(Boolean)
        .join("\n"),
      translation:
        action === "paper-plan"
          ? ""
          : state.plan?.result.summary?.slice(0, 2000) || "",
      model,
      depth: $("guide-depth").value,
    };
  }
  function requestKey(action, sources, question = "") {
    return JSON.stringify([GUIDE_PROMPT_VERSION, requestBody(action, sources, question)]);
  }
  function cached(action, sources, key) {
    const value =
      action === "paper-plan"
        ? state.plan?.result
        : state.results[sources[0].id];
    if (value?._context !== key) return null;
    try {
      return validateGuide(value, JSON.stringify(sources));
    } catch {
      return null;
    }
  }
  function startTask(action, sources, question = "") {
    const key = requestKey(action, sources, question);
    if (tasks.has(key)) return tasks.get(key);
    const task = { controller: new AbortController(), key };
    const startedSession = session;
    task.promise = bridge
      .request("study", {
        signal: task.controller.signal,
        body: requestBody(action, sources, question),
      })
      .then(async (result) => {
        if (startedSession !== session || task.controller.signal.aborted)
          throw new DOMException("已取消", "AbortError");
        validateGuide(result, JSON.stringify(sources), action);
        result._context = key;
        if (action === "paper-plan") state.plan = { result, sources };
        else if (!question) state.results[sources[0].id] = result;
        await persist();
        return result;
      })
      .finally(() => {
        if (tasks.get(key) === task) tasks.delete(key);
      });
    tasks.set(key, task);
    return task;
  }
  function prepareNext() {
    if (
      !$("guide-prefetch").checked ||
      !autoReading ||
      panel.hidden ||
      index + 1 >= units.length
    )
      return;
    const next = index + 1,
      sources = [units[next]],
      key = requestKey("paper-read", sources),
      startedSession = session;
    if (cached("paper-read", sources, key)) {
      $("guide-prefetch-status").textContent = "下一段已准备好。";
      return;
    }
    $("guide-prefetch-status").textContent = "正在提前准备下一段…";
    startTask("paper-read", sources)
      .promise.then(() => {
        if (session === startedSession && index + 1 === next)
          $("guide-prefetch-status").textContent = "下一段已准备好。";
      })
      .catch((e) => {
        if (session === startedSession && index + 1 === next)
          $("guide-prefetch-status").textContent =
            e.name === "AbortError"
              ? ""
              : "下一段未能提前准备，可点击精读重试。";
      });
  }
  async function run(action, question = "", force = false) {
    if (busy || !units.length) return;
    if (action === "paper-read") autoReading = true;
    const sources = action === "paper-plan" ? overview() : [units[index]],
      key = requestKey(action, sources, question);
    const saved = !force && !question && cached(action, sources, key);
    if (saved) {
      show(saved, sources);
      status("已加载缓存，即时显示，未重复调用 GPT。");
      if (action === "paper-read") prepareNext();
      return;
    }
    if (force) {
      tasks.get(key)?.controller.abort();
      tasks.delete(key);
    }
    busy = true;
    const token = ++generation;
    controls();
    const alreadyRunning = tasks.has(key),
      task = startTask(action, sources, question);
    controller = task.controller;
    let succeeded = false;
    const started = Date.now();
    const label = alreadyRunning
      ? "正在接续已准备的任务"
      : action === "paper-plan"
        ? "正在生成阅读重点与先修知识"
        : "正在解读并核对原文";
    status(label + "…");
    const timer = setInterval(() => {
      if (token === generation)
        status(
          `${label}… 已等待 ${Math.floor((Date.now() - started) / 1000)} 秒`,
        );
    }, 1000);
    try {
      const result = await task.promise;
      if (token !== generation) return;
      show(result, sources);
      succeeded = true;
      status("已完成，引用已核对。可选择深入讲解获取更多细节。");
    } catch (e) {
      if (token === generation)
        status(e.name === "AbortError" ? "已停止，可重新生成。" : e.message);
    } finally {
      clearInterval(timer);
      if (token === generation) {
        busy = false;
        controls();
        if (
          succeeded &&
          action === "paper-read" &&
          !question &&
          cached(action, sources, key)
        )
          prepareNext();
      }
    }
  }
  function reset(hide = true) {
    generation++;
    session++;
    for (const task of tasks.values()) task.controller.abort();
    tasks.clear();
    autoReading = false;
    $("guide-prefetch-status").textContent = "";
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
    for (const task of tasks.values())
      if (task.controller !== controller) task.controller.abort();
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
  $("guide-regenerate").onclick = () => run("paper-read", "", true);
  for (const id of ["guide-background", "guide-depth", "guide-prefetch"])
    $(id).onchange = () => {
      for (const [key, task] of tasks)
        if (task.controller !== controller || !busy) {
          task.controller.abort();
          tasks.delete(key);
        }
      $("guide-prefetch-status").textContent = "";
      position();
      persist().catch((e) => status(e.message));
    };
  $("guide-stop").onclick = () => controller?.abort();
  $("guide-locate").onclick = () => units[index] && locate(units[index]);
  for (const [id, delta] of [
    ["guide-prev", -1],
    ["guide-next", 1],
  ])
    $(id).onclick = () => {
      index += delta;
      position();
      if (autoReading) run("paper-read");
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
      for (const task of tasks.values())
        if (task.controller !== controller) task.controller.abort();
    },
  };
}
