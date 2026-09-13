import { StudyBridge } from "./study-bridge";
import { readPreference, savePreference } from "./theme";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const safeUrl = (s) => {
  try {
    const u = new URL(s);
    return ["https:", "http:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
};
export function createStudyPanel({ icon, refreshIcons, notify, speechUI }) {
  const bridge = new StudyBridge();
  const $ = (id) => document.getElementById(id);
  const card = document.createElement("section");
  card.id = "translation-card";
  card.className = "translation-card";
  card.hidden = true;
  card.setAttribute("aria-label", "选区翻译");
  card.innerHTML = `<div class="translation-heading"><span>${icon("languages")} GPT 翻译</span><div><button id="translation-copy" class="icon-button" aria-label="复制译文" disabled>${icon("copy")}</button><button id="translation-close" class="icon-button" aria-label="关闭翻译框">${icon("x")}</button></div></div><small id="translation-model" hidden></small><p id="translation-original"></p><div id="translation-result" role="status"></div><div class="translation-support"><button id="translation-retry" class="text-button" hidden>重新翻译</button><button id="translation-account" class="text-button" hidden>连接与登录 ${icon("arrow-up-right")}</button></div><div class="translation-actions"><button data-study-action="analyze" disabled>${icon("network")} 句法解析</button><button data-study-action="explain" disabled>${icon("lightbulb")} 解释</button><button data-study-action="research" disabled>${icon("search")} 进一步搜索</button><button id="translation-speak" aria-label="朗读原文">${icon("volume-2")}</button></div>`;
  $("reader-view").append(card);
  const panel = document.createElement("aside");
  panel.id = "study-panel";
  panel.className = "study-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "英语学习助手");
  panel.innerHTML = `<div class="study-heading"><div><span class="eyebrow">READ. UNDERSTAND. EXPLORE.</span><h2>${icon("sparkles")} 读懂字里行间</h2></div><button id="study-close" class="icon-button" aria-label="关闭学习侧栏">${icon("x")}</button></div><div class="study-tabs"><button data-study-tab="analyze" class="active">句法解析</button><button data-study-tab="explain">解释</button><button data-study-tab="research">进一步搜索</button></div><blockquote id="study-original"></blockquote><div class="study-translation"><span>中文翻译</span><p id="study-translation"></p></div><div class="study-status-row"><span id="study-status" role="status"></span><button id="study-cancel" class="text-button" hidden>停止</button><button id="study-retry" class="text-button" hidden>重试</button></div><div id="study-content"><p class="study-empty">选择一句话，从译文下方开始探索。</p></div><form id="study-question-form"><label for="study-question">还想弄懂哪里？</label><div><input id="study-question" maxlength="1500" placeholder="例如：这里为什么用过去完成时？" autocomplete="off"><button class="icon-button" aria-label="发送追问" type="submit">${icon("arrow-up-right")}</button></div><p>追问会结合当前原句；在搜索页发送会联网检索。</p></form>`;
  document.querySelector(".reader-body").append(panel);
  const dialog = document.createElement("dialog");
  dialog.id = "account-dialog";
  dialog.innerHTML = `<div class="dialog-title"><h2>连接你的 GPT 阅读助手</h2><button id="account-close" class="icon-button" aria-label="关闭账号设置">${icon("x")}</button></div><p>通过 ChatGPT 官方登录，使用账号的 Codex 额度。无需 API Key。</p><div class="account-step"><span class="step-number">1</span><div><h3>连接这台电脑</h3><p>首次使用在项目目录运行 <code>npm run start</code>，并保持终端开启。</p><button id="bridge-connect" class="secondary">连接本机服务 ${icon("arrow-up-right")}</button><a class="account-local-link" href="http://127.0.0.1:4318/" target="_blank" rel="noopener noreferrer">打开本机阅读器</a></div></div><div class="account-step"><span class="step-number">2</span><div><h3>登录 ChatGPT 账号</h3><p id="account-status" role="status">连接后即可登录。</p><div class="account-buttons"><button id="account-login" class="primary" disabled>登录 ChatGPT ${icon("arrow-up-right")}</button><button id="account-refresh" class="secondary" disabled>刷新状态</button><button id="account-logout" class="text-button" hidden>退出账号</button></div><a id="account-login-link" hidden target="_blank" rel="noopener noreferrer">打开官方登录页面</a></div></div><div class="account-preferences"><p>翻译自动优先使用快速模型 GPT-5.6-Luna；账号未提供时使用账号默认模型。下方选择仅用于解析、搜索与论文带读。</p><div class="model-heading"><label for="study-model">解析、搜索与带读模型</label><button id="study-model-refresh" class="text-button" type="button">刷新模型</button></div><input id="study-model-search" type="search" placeholder="搜索模型名称或 ID" aria-label="搜索模型"><select id="study-model"><option value="">账号默认模型</option></select><p id="study-model-note" role="status"></p><p id="study-model-status" role="status"></p><details class="model-custom"><summary>手动指定模型</summary><p>填写完整模型 ID，用于目录尚未列出的模型。能否使用取决于账号和 Codex 支持范围；不支持时会显示错误。</p><div class="model-custom-row"><input id="study-model-custom" maxlength="128" placeholder="完整模型 ID" aria-label="自定义模型 ID"><button id="study-model-apply" class="secondary" type="button">使用</button></div></details><label class="auto-translate-option"><input id="study-auto" type="checkbox"> 划词后自动翻译</label><p id="account-usage"></p><p>每次翻译或解析会使用 Codex 额度；本页会复用相同选区的结果。只有“进一步搜索”会联网检索。选中文字会发送给 OpenAI，整本书不会自动上传。</p></div><p id="account-error" class="account-error" role="status"></p>`;
  document.body.append(dialog);
  let text = "",
    translation = "",
    anchor = null,
    version = 0,
    translationAbort,
    debounce,
    action = "analyze",
    lastQuestion = "",
    loginPoll,
    ready = false;
  let auto = readPreference("zr-auto-translate", "true") !== "false";
  let model = readPreference("zr-study-model", "");
  let modelCatalog = [];
  const cache = new Map();
  const details = new Map();
  const detailQuestions = new Map();
  const accountButtons = () => document.querySelectorAll(".account-open");
  function setCache(key, value) {
    if (cache.size >= 80) cache.delete(cache.keys().next().value);
    cache.set(key, value);
  }
  function key(kind, question = "") {
    return JSON.stringify([
      bridge.accountInfo?.email,
      model,
      kind,
      text,
      question,
    ]);
  }
  function positionCard() {
    const stage = $("reading-stage").getBoundingClientRect();
    const width = Math.min(430, stage.width - 24);
    card.style.width = `${Math.max(250, width)}px`;
    const left = Math.max(
      stage.left + 12,
      Math.min(anchor?.left ?? stage.left + 30, stage.right - width - 12),
    );
    const height = Math.min(card.offsetHeight || 310, window.innerHeight - 100);
    const top = Math.max(
      78,
      Math.min(
        (anchor?.bottom ?? stage.top + 50) + 12,
        window.innerHeight - height - 76,
      ),
    );
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }
  function setTranslationStatus(
    message,
    { error = false, login = false } = {},
  ) {
    $("translation-model").hidden = true;
    $("translation-result").textContent = message;
    if (!translation) $("study-translation").textContent = message;
    card.classList.toggle("has-error", error);
    $("translation-retry").hidden = !error;
    $("translation-account").hidden = !login;
    positionCard();
  }
  function actionsEnabled(enabled) {
    card
      .querySelectorAll("[data-study-action]")
      .forEach(
        (b) =>
          (b.disabled =
            !text || text.length > 8000 || !bridge.accountInfo?.loggedIn),
      );
    $("translation-copy").disabled = !enabled;
  }
  function stopRequests() {
    clearTimeout(debounce);
    translationAbort?.abort();
    for (const task of details.values()) task.controller.abort();
    details.clear();
    detailQuestions.clear();
  }
  function clear() {
    version++;
    stopRequests();
    text = "";
    translation = "";
    card.hidden = true;
    panel.hidden = true;
    $("study-toggle").setAttribute("aria-expanded", "false");
  }
  async function translate() {
    if (!ready || !text) return;
    translationAbort?.abort();
    const current = version;
    translationAbort = new AbortController();
    const signal = translationAbort.signal;
    actionsEnabled(false);
    $("translation-retry").hidden = true;
    $("translation-account").hidden = true;
    if (!bridge.token || !bridge.accountInfo?.loggedIn) {
      setTranslationStatus(
        "连接本机服务并登录 ChatGPT 后，即可自动翻译这一段。",
        { login: true },
      );
      return;
    }
    if (text.length > 8000) {
      setTranslationStatus("选区超过 8000 个字符，请分段翻译。", {
        error: true,
      });
      return;
    }
    setTranslationStatus("正在翻译…任务繁忙时会自动等待，无需重试。");
    try {
      const cacheKey = key("translate");
      let result = cache.get(cacheKey);
      if (!result) {
        result = await bridge.study(
          { action: "translate", text, model },
          signal,
        );
        if (signal.aborted || version !== current) return;
        setCache(cacheKey, result);
      }
      if (version !== current) return;
      translation = result.translation;
      $("translation-model").textContent = result.model ? `翻译模型 · ${result.model}` : "";
      $("translation-model").hidden = !result.model;
      $("translation-result").textContent = translation;
      $("study-translation").textContent = translation;
      card.classList.remove("has-error");
      actionsEnabled(true);
      positionCard();
    } catch (error) {
      if (signal.aborted || current !== version) return;
      setTranslationStatus(error.message, {
        error: true,
        login: !bridge.accountInfo?.loggedIn || !bridge.token,
      });
    }
  }
  function select(selected, rect) {
    if (!selected) {
      clear();
      return;
    }
    if (selected === text) {
      anchor = rect || anchor;
      return;
    }
    version++;
    stopRequests();
    text = selected;
    translation = "";
    anchor = rect;
    lastQuestion = "";
    card.hidden = false;
    panel.hidden = true;
    $("study-toggle").setAttribute("aria-expanded", "false");
    $("translation-original").textContent = text;
    $("study-original").textContent = text;
    $("study-translation").textContent = "";
    $("study-question").value = "";
    $("study-content").replaceChildren();
    $("study-status").textContent = "";
    actionsEnabled(false);
    setTranslationStatus(
      auto ? "准备翻译…" : "已关闭自动翻译，点击下方“翻译”开始。",
    );
    $("translation-retry").textContent = auto ? "重新翻译" : "翻译";
    $("translation-retry").hidden = auto;
    if (auto) debounce = setTimeout(translate, 420);
  }
  function renderResult(result) {
    const content = $("study-content");
    content.replaceChildren();
    if (action === "research") {
      const badge = document.createElement("p");
      badge.className = "study-search-status";
      badge.textContent = result.searched
        ? "已进行联网检索 · 请结合来源核对"
        : "未完成联网检索 · 下方可继续手动搜索";
      content.append(badge);
    }
    if (result.summary) {
      const paragraph = document.createElement("p");
      paragraph.className = "study-summary";
      paragraph.textContent = result.summary;
      content.append(paragraph);
    }
    if (result.grammar?.length) {
      const block = document.createElement("section");
      block.className = "grammar-list";
      block.innerHTML =
        "<h3>句子结构</h3>" +
        result.grammar
          .map(
            (part, index) =>
              `<div class="grammar-part"><span class="grammar-label tone-${index % 4}">${esc(part.part)}</span><strong>${esc(part.text)}</strong><p>${esc(part.explanation)}</p></div>`,
          )
          .join("");
      content.append(block);
    }
    if (result.vocabulary?.length) {
      const block = document.createElement("section");
      block.className = "vocabulary-list";
      block.innerHTML =
        "<h3>重点表达</h3>" +
        result.vocabulary
          .map(
            (word) =>
              `<div><strong>${esc(word.term)}</strong><p>${esc(word.meaning)}</p><em>${esc(word.example)}</em></div>`,
          )
          .join("");
      content.append(block);
    }
    const sources = (result.sources || []).filter((s) => safeUrl(s.url));
    if (sources.length) {
      const block = document.createElement("section");
      block.className = "study-sources";
      block.innerHTML = "<h3>参考来源</h3>";
      for (const source of sources) {
        const a = document.createElement("a");
        a.href = safeUrl(source.url);
        a.textContent = source.title || new URL(source.url).hostname;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        block.append(a);
      }
      content.append(block);
    }
    if (result.searchQueries?.length) {
      const block = document.createElement("section");
      block.className = "study-queries";
      block.innerHTML = "<h3>继续搜索</h3>";
      for (const query of result.searchQueries.slice(0, 5)) {
        const a = document.createElement("a");
        a.href = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
        a.textContent = query;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        block.append(a);
      }
      content.append(block);
    }
  }
  async function detail(kind, question = detailQuestions.get(kind) || "") {
    if (!text) {
      notify("先在正文中选择一句话。");
      return;
    }
    action = kind;
    lastQuestion = question;
    detailQuestions.set(kind, question);
    const current = version;
    speechUI.close();
    card.hidden = true;
    panel.hidden = false;
    $("study-toggle").setAttribute("aria-expanded", "true");
    $("study-translation").textContent =
      translation || $("translation-result").textContent;
    document
      .querySelectorAll("[data-study-tab]")
      .forEach((b) =>
        b.classList.toggle("active", b.dataset.studyTab === kind),
      );
    $("study-content").replaceChildren();
    $("study-status").textContent =
      kind === "research" ? "正在检索并整理来源…" : "正在分析这句话…";
    $("study-cancel").hidden = false;
    $("study-retry").hidden = true;
    const cacheKey = key(kind, question);
    let task = details.get(kind);
    if (task && task.key !== cacheKey) {
      task.controller.abort();
      details.delete(kind);
      task = null;
    }
    try {
      let result = cache.get(cacheKey);
      if (!result) {
        if (!task) {
          const controller = new AbortController();
          task = { controller, key: cacheKey };
          task.promise = bridge
            .study(
              { action: kind, text, translation, question, model },
              controller.signal,
            )
            .then((result) => {
              if (!controller.signal.aborted && version === current)
                setCache(cacheKey, result);
              return result;
            })
            .finally(() => {
              if (details.get(kind) === task) details.delete(kind);
            });
          details.set(kind, task);
        }
        result = await task.promise;
      }
      if (
        version !== current ||
        action !== kind ||
        detailQuestions.get(kind) !== question ||
        task?.controller.signal.aborted
      )
        return;
      renderResult(result);
      $("study-status").textContent = `${result.model || "GPT"} · 已完成`;
    } catch (error) {
      if (
        version !== current ||
        action !== kind ||
        task?.controller.signal.aborted
      )
        return;
      $("study-status").textContent = error.message;
      $("study-retry").hidden = false;
    } finally {
      if (
        version === current &&
        action === kind &&
        !task?.controller.signal.aborted
      )
        $("study-cancel").hidden = true;
    }
  }
  async function refreshAccount() {
    $("account-error").textContent = "";
    try {
      const account = await bridge.account();
      $("bridge-connect").textContent = "重新连接本机服务";
      $("account-refresh").disabled = false;
      $("account-login").disabled = false;
      $("account-status").textContent = account.loggedIn
        ? `已登录 ${account.email} · ${account.plan || "ChatGPT"} · 使用 Codex 额度`
        : account.error || "本机服务已连接，请登录 ChatGPT 账号。";
      $("account-logout").hidden = !account.loggedIn;
      $("account-login").hidden = account.loggedIn;
      accountButtons().forEach((b) =>
        b.classList.toggle("account-connected", account.loggedIn),
      );
      if (account.loggedIn) {
        clearInterval(loginPoll);
        $("account-login-link").hidden = true;
        const [, limits] = await Promise.all([
          refreshModels(),
          bridge.request("limits").catch(() => null),
        ]);
        const used = limits?.rateLimits?.primary?.usedPercent;
        $("account-usage").textContent =
          typeof used === "number"
            ? `当前额度窗口已使用 ${Math.round(used)}%。以账号官方用量页面为准。`
            : "额度与可用模型以你的 ChatGPT / Codex 账号为准。";
        if (text && !translation && auto) translate();
      }
    } catch (error) {
      $("account-error").textContent = error.message;
      $("account-status").textContent = "尚未连接可用的本机服务。";
    }
  }
  function showAccount() {
    dialog.showModal();
    if (bridge.token) refreshAccount();
  }
  accountButtons().forEach((b) => (b.onclick = showAccount));
  $("translation-account").onclick = showAccount;
  $("account-close").onclick = () => dialog.close();
  $("bridge-connect").onclick = async () => {
    try {
      $("account-error").textContent = "在新窗口点击“连接阅读网页”。";
      await bridge.connect();
      await refreshAccount();
    } catch (error) {
      $("account-error").textContent = error.message;
    }
  };
  $("account-login").onclick = async () => {
    const popup = window.open(
      "about:blank",
      "zhereader-chatgpt-login",
      "width=780,height=780",
    );
    if (popup) popup.opener = null;
    try {
      $("account-error").textContent = "";
      const result = await bridge.request("login", { method: "POST" });
      const url = new URL(result.authUrl);
      if (
        url.protocol !== "https:" ||
        !["auth.openai.com", "chatgpt.com", "auth0.openai.com"].includes(
          url.hostname,
        )
      )
        throw new Error("收到无效的官方登录地址。");
      $("account-login-link").href = url.href;
      $("account-login-link").hidden = false;
      if (popup) popup.location.href = url.href;
      $("account-status").textContent =
        "请在官方页面完成登录，完成后这里会自动更新。";
      clearInterval(loginPoll);
      let polls = 0;
      loginPoll = setInterval(() => {
        if (++polls > 90) {
          clearInterval(loginPoll);
          return;
        }
        refreshAccount();
      }, 2000);
    } catch (error) {
      popup?.close();
      $("account-error").textContent = error.message;
    }
  };
  $("account-refresh").onclick = refreshAccount;
  $("account-logout").onclick = async () => {
    try {
      stopRequests();
      await bridge.request("logout", { method: "POST" });
      cache.clear();
      clear();
      await refreshAccount();
    } catch (error) {
      $("account-error").textContent = error.message;
    }
  };
  function renderModels() {
    const query = $("study-model-search").value.trim().toLowerCase();
    $("study-model").replaceChildren(new Option("账号默认模型", ""));
    for (const [hidden, label] of [
      [false, "常用模型"],
      [true, "更多模型 · 默认隐藏"],
    ]) {
      const group = document.createElement("optgroup");
      group.label = label;
      for (const m of modelCatalog.filter(
        (m) =>
          Boolean(m.hidden) === hidden &&
          (m.id === model || `${m.name} ${m.id}`.toLowerCase().includes(query)),
      )) {
        group.append(
          new Option(`${m.name || m.id}${m.isDefault ? " · 默认" : ""}`, m.id),
        );
      }
      if (group.children.length) $("study-model").append(group);
    }
    if (model && !modelCatalog.some((m) => m.id === model))
      $("study-model").append(new Option(`${model} · 手动指定`, model));
    $("study-model").value = model;
    const selected = modelCatalog.find((m) => m.id === model);
    $("study-model-note").textContent = selected
      ? `${selected.description || selected.id}${selected.hidden ? " · 默认隐藏，可能用途有限或不支持当前任务。" : ""}`
      : model
        ? "手动指定的模型；可用性将在请求时确认，不会自动替换为其他模型。"
        : "使用账号默认模型。列表来自 Codex，包含默认隐藏条目。";
  }
  async function refreshModels() {
    $("study-model-refresh").disabled = true;
    $("study-model-status").textContent = "正在获取完整模型列表…";
    try {
      const { models } = await bridge.request("models");
      modelCatalog = models;
      renderModels();
      $("study-model-status").textContent =
        `共 ${models.length} 个模型（含 ${models.filter((m) => m.hidden).length} 个默认隐藏条目）。实际可用性以账号为准。`;
    } catch (error) {
      $("study-model-status").textContent =
        `模型列表刷新失败：${error.message} 已保留当前选择。`;
    } finally {
      $("study-model-refresh").disabled = false;
    }
  }
  function chooseModel(value) {
    if (value && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) {
      $("study-model-status").textContent =
        "请输入有效的完整模型 ID（字母、数字、点、短横线、下划线或冒号）。";
      return;
    }
    version++;
    stopRequests();
    translation = "";
    panel.hidden = true;
    $("study-toggle").setAttribute("aria-expanded", "false");
    model = value;
    savePreference("zr-study-model", model);
    renderModels();
    if (text) {
      card.hidden = false;
      translate();
    }
  }
  $("study-model").onchange = (e) => chooseModel(e.target.value);
  $("study-model-search").oninput = renderModels;
  $("study-model-refresh").onclick = refreshModels;
  $("study-model-apply").onclick = () =>
    chooseModel($("study-model-custom").value.trim());
  renderModels();
  $("study-auto").checked = auto;
  $("study-auto").onchange = (e) => {
    auto = e.target.checked;
    savePreference("zr-auto-translate", String(auto));
    if (auto && text) translate();
    else if (!auto) {
      clearTimeout(debounce);
    }
  };
  $("translation-close").onclick = () => {
    translationAbort?.abort();
    clearTimeout(debounce);
    card.hidden = true;
  };
  $("translation-retry").onclick = translate;
  $("translation-speak").onclick = () => {
    speechUI.speakSelection();
    card.hidden = true;
    panel.hidden = true;
  };
  $("translation-copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(translation);
      notify("译文已复制");
    } catch {
      notify("无法复制，请在翻译框中手动选择译文。");
    }
  };
  card
    .querySelectorAll("[data-study-action]")
    .forEach((b) => (b.onclick = () => detail(b.dataset.studyAction)));
  panel
    .querySelectorAll("[data-study-tab]")
    .forEach((b) => (b.onclick = () => detail(b.dataset.studyTab)));
  $("study-close").onclick = () => {
    panel.hidden = true;
    $("study-toggle").setAttribute("aria-expanded", "false");
  };
  $("study-toggle").onclick = () => {
    if (!panel.hidden) {
      panel.hidden = true;
      $("study-toggle").setAttribute("aria-expanded", "false");
    } else if (text) detail(action);
    else notify("先在正文中选择一句话，就能翻译与解析。");
  };
  $("study-cancel").onclick = () => {
    details.get(action)?.controller.abort();
    details.delete(action);
    $("study-status").textContent = "已停止";
    $("study-cancel").hidden = true;
    $("study-retry").hidden = false;
  };
  $("study-retry").onclick = () => detail(action, lastQuestion);
  $("study-question-form").onsubmit = (e) => {
    e.preventDefault();
    const question = $("study-question").value.trim();
    if (!question) return;
    detail(action === "research" ? "research" : "explain", question);
  };
  window.addEventListener("resize", () => {
    if (!card.hidden) positionCard();
  });
  if (bridge.token) refreshAccount();
  refreshIcons();
  return {
    selection: select,
    reset: clear,
    setReady(value) {
      ready = value;
    },
    close() {
      panel.hidden = true;
      card.hidden = true;
      $("study-toggle").setAttribute("aria-expanded", "false");
    },
  };
}
