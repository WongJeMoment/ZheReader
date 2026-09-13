import { SpeechPlayer } from "./speech";

export function createSpeechPanel({ getReader, icon, refreshIcons, notify }) {
  const panel = document.createElement("aside");
  panel.id = "speech-panel";
  panel.className = "speech-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "语音朗读设置");
  panel.innerHTML = `
    <div class="speech-heading"><div><span class="eyebrow">LISTEN TO THE PAGES</span><h2>${icon("headphones")} 让好书，读给你听</h2></div><button class="icon-button" id="speech-close" aria-label="收起朗读面板">${icon("x")}</button></div>
    <p class="speech-intro">从第一页听到最后一章，或只听你选中的一段。</p>
    <div class="speech-starts"><button class="primary" id="speech-all">${icon("play")} 从头朗读全文</button><button class="secondary" id="speech-current">从当前页／章开始</button></div>
    <div class="speech-selection"><div><span>选中文字</span><span id="selection-count">尚未选择</span></div><p id="selection-preview">在正文中用鼠标拖选文字，再点击朗读。</p><button class="secondary" id="speech-selected" disabled>${icon("volume-2")} 朗读选中部分</button></div>
    <section class="speech-player" aria-label="朗读播放器"><div class="speech-now"><span class="speech-indicator"></span><strong id="speech-state" role="status">准备好就开始吧</strong></div><p id="speech-location"></p><p id="speech-text">文字之外，还有声音相伴。</p><div class="speech-controls"><button class="secondary" id="speech-pause" disabled>${icon("pause")} 暂停</button><button class="secondary" id="speech-stop" disabled>${icon("square")} 停止</button></div></section>
    <div class="speech-settings"><div class="speech-settings-title"><h3>调成你喜欢的声音</h3><button id="speech-preview" class="text-button">${icon("volume-2")} 试听</button></div><label class="voice-field" for="speech-voice">朗读声音</label><select id="speech-voice" aria-label="朗读声音"></select><p id="voice-note" class="speech-help"></p>
    <label class="speech-slider" for="speech-rate"><span>语速</span><output id="speech-rate-value">1.0×</output></label><input id="speech-rate" type="range" min="0.5" max="2" step="0.1">
    <label class="speech-slider" for="speech-pitch"><span>音调</span><output id="speech-pitch-value">1.0</output></label><input id="speech-pitch" type="range" min="0.5" max="1.5" step="0.1">
    <label class="speech-slider" for="speech-volume"><span>音量</span><output id="speech-volume-value">100%</output></label><input id="speech-volume" type="range" min="0" max="1" step="0.05">
    <p class="speech-help">设置自动保存；播放时修改设置会从当前句重新朗读。试听前请先停止播放。</p></div>
    <p class="speech-footnote">扫描版 PDF 需先识别文字（OCR）。多栏 PDF 的朗读顺序取决于文件内的文字顺序。</p>`;
  document.querySelector(".reader-body").append(panel);
  const selectionButton = document.createElement("button");
  selectionButton.id = "selection-speak";
  selectionButton.className = "selection-speak";
  selectionButton.hidden = true;
  selectionButton.innerHTML = `${icon("volume-2")} 朗读选中文字 <span></span>`;
  document.querySelector("#reading-stage").append(selectionButton);
  const $ = (id) => document.getElementById(id);
  let ready = false,
    selectedText = "",
    voiceSignature = "";
  const player = new SpeechPlayer({ onChange: render, onError: notify });
  function render(p) {
    const busy = ["playing", "paused", "loading"].includes(p.state);
    const states = {
      idle: "准备好就开始吧",
      loading: "正在提取文字…",
      playing: "正在朗读",
      paused: "已暂停",
      finished: "本次朗读已完成",
      empty: "没有可朗读的文字",
      error: "朗读未能继续",
    };
    $("speech-state").textContent = p.supported
      ? states[p.state]
      : "当前浏览器不支持语音朗读";
    $("speech-location").textContent = p.current
      ? `${p.label} · ${p.current.location} · 第 ${p.current.index} / ${p.current.count} 句`
      : "";
    $("speech-text").textContent =
      p.current?.text ||
      (p.state === "finished"
        ? "读到这里，休息一下也很好。"
        : "文字之外，还有声音相伴。");
    panel.dataset.state = p.state;
    const toggle = $("speech-toggle");
    toggle.classList.toggle("speech-active", busy);
    toggle.querySelector("span").textContent = busy
      ? p.state === "paused"
        ? "已暂停"
        : "听书中"
      : "听书";
    $("speech-pause").disabled = !busy;
    $("speech-pause").innerHTML =
      `${icon(p.state === "paused" ? "play" : "pause")} ${p.state === "paused" ? "继续" : "暂停"}`;
    $("speech-stop").disabled = !busy;
    $("speech-all").disabled = $("speech-current").disabled =
      !ready || !p.supported;
    $("speech-selected").disabled = !ready || !selectedText || !p.supported;
    $("speech-preview").disabled = busy || !p.supported;
    selectionButton.disabled = !ready || !p.supported;
    const signature = JSON.stringify(
      p.voices.map((v) => [v.voiceURI, v.name, v.lang, v.localService]),
    );
    if (signature !== voiceSignature || !$("speech-voice").options.length) {
      voiceSignature = signature;
      const options = [
        new Option(
          p.voices.length ? "自动选择 · 匹配中英文" : "系统默认 · 等待声音列表",
          "",
        ),
      ];
      const voices = [...p.voices].sort(
        (a, b) =>
          Number(b.lang.startsWith("zh")) - Number(a.lang.startsWith("zh")) ||
          a.name.localeCompare(b.name),
      );
      for (const v of voices)
        options.push(
          new Option(
            `${v.name} · ${v.lang} · ${v.localService ? "本地" : "在线"}`,
            v.voiceURI,
          ),
        );
      $("speech-voice").replaceChildren(...options);
    }
    const unavailable =
      p.settings.voice &&
      !p.voices.some((v) => v.voiceURI === p.settings.voice);
    $("speech-voice").value = unavailable ? "" : p.settings.voice;
    const voice = p.voices.find((v) => v.voiceURI === p.settings.voice);
    $("voice-note").textContent = unavailable
      ? "上次的声音在此设备不可用，暂时自动选择。"
      : !p.voices.length
        ? "声音由电脑和浏览器提供；若一直没有声音，请安装系统语音包或更换浏览器。"
        : voice
          ? voice.localService
            ? "当前使用设备上的本地声音。"
            : "当前为在线声音，朗读文字可能由浏览器发送给语音服务商。"
          : "优先匹配本地中文或英文声音；没有本地声音时可能使用在线语音服务。";
    for (const key of ["rate", "pitch", "volume"]) {
      $(`speech-${key}`).value = p.settings[key];
      $(`speech-${key}-value`).textContent =
        key === "volume"
          ? `${Math.round(p.settings[key] * 100)}%`
          : `${p.settings[key].toFixed(1)}${key === "rate" ? "×" : ""}`;
    }
    refreshIcons();
  }
  function open() {
    panel.hidden = false;
    $("speech-toggle").setAttribute("aria-expanded", "true");
  }
  function close() {
    panel.hidden = true;
    $("speech-toggle").setAttribute("aria-expanded", "false");
  }
  $("speech-toggle").onclick = () => (panel.hidden ? open() : close());
  $("speech-close").onclick = close;
  $("speech-all").onclick = () => {
    const reader = getReader();
    if (ready && reader)
      player.start((signal) => reader.speechSections({ signal }), "全文朗读");
  };
  $("speech-current").onclick = () => {
    const reader = getReader();
    if (ready && reader)
      player.start(
        (signal) => reader.speechSections({ fromCurrent: true, signal }),
        "接着朗读",
      );
  };
  function speakSelection() {
    if (!selectedText || !ready) return;
    open();
    player.start([{ text: selectedText, location: "选中的文字" }], "选区朗读");
  }
  $("speech-selected").onclick = selectionButton.onclick = speakSelection;
  // Preserve browser selection while the user activates a playback control.
  selectionButton.onpointerdown = (e) => e.preventDefault();
  $("speech-pause").onclick = () => player.togglePause();
  $("speech-stop").onclick = () => player.stop();
  $("speech-voice").onchange = (e) =>
    player.setSettings({ voice: e.target.value });
  for (const key of ["rate", "pitch", "volume"])
    $(`speech-${key}`).oninput = (e) =>
      player.setSettings({ [key]: Number(e.target.value) });
  $("speech-preview").onclick = () =>
    player.start(
      [
        {
          text: "你好，欢迎来到 ZheReader。让我们放慢脚步，听一段好文字。",
          location: "声音试听",
        },
      ],
      "试听",
    );
  window.addEventListener("pagehide", () => player.stop());
  function selection(text) {
    if (text === selectedText) return;
    selectedText = text;
    const count = Array.from(text).length;
    selectionButton.hidden = !text;
    selectionButton.querySelector("span").textContent = `${count} 字`;
    $("selection-count").textContent = count ? `${count} 字` : "尚未选择";
    $("selection-preview").textContent = text
      ? Array.from(text).slice(0, 110).join("") + (count > 110 ? "…" : "")
      : "在正文中用鼠标拖选文字，再点击朗读。";
    $("speech-selected").disabled = !ready || !text || !player.supported;
  }
  return {
    selection,
    setReady(value) {
      ready = value;
      render(player);
    },
    reset() {
      ready = false;
      player.stop();
      selection("");
      close();
    },
  };
}
