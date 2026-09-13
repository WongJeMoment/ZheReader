import { readPreference, savePreference } from "./theme";

// Keep utterances short to avoid desktop speech engines stalling on long text.
export function splitSpeechText(text, limit = 140) {
  const sentences =
    String(text)
      .replace(/\s+/g, " ")
      .trim()
      .match(/[^。！？!?；;\n]+[。！？!?；;]?/gu) || [];
  const chunks = [];
  for (const sentence of sentences) {
    let chars = Array.from(sentence.trim());
    while (chars.length > limit) {
      const prefix = chars.slice(0, limit).join("");
      const breakAt = Math.max(
        prefix.lastIndexOf(" "),
        prefix.lastIndexOf("，"),
        prefix.lastIndexOf(","),
        prefix.lastIndexOf("。"),
      );
      const length =
        breakAt > limit / 2
          ? Array.from(prefix.slice(0, breakAt + 1)).length
          : limit;
      chunks.push(chars.splice(0, length).join("").trim());
    }
    if (chars.length) chunks.push(chars.join(""));
  }
  return chunks.filter(Boolean);
}
export function documentText(root) {
  const blocks =
    /^(p|div|section|article|h[1-6]|li|tr|blockquote|header|footer|dt|dd)$/i;
  function visit(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return "";
    const name = node.localName;
    if (
      /^(script|style|noscript|head|nav|svg)$/i.test(name) ||
      node.hasAttribute("hidden") ||
      node.getAttribute("aria-hidden") === "true" ||
      /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(
        node.getAttribute("style") || "",
      )
    )
      return "";
    if (name === "br") return "\n";
    const text = Array.from(node.childNodes, visit).join("");
    return blocks.test(name) ? `\n${text}\n` : text;
  }
  return visit(root)
    .replace(/[\t \u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
const numeric = (value, min, max, fallback) =>
  Number.isFinite(Number(value))
    ? Math.max(min, Math.min(max, Number(value)))
    : fallback;
export class SpeechPlayer {
  constructor({
    onChange = () => {},
    onError = () => {},
    engine = globalThis.speechSynthesis,
    Utterance = globalThis.SpeechSynthesisUtterance,
  } = {}) {
    this.engine = engine;
    this.Utterance = Utterance;
    this.supported = !!engine && !!Utterance;
    this.onChange = onChange;
    this.onError = onError;
    this.settings = {
      voice: readPreference("zr-voice", ""),
      rate: numeric(readPreference("zr-rate", "1"), 0.5, 2, 1),
      pitch: numeric(readPreference("zr-pitch", "1"), 0.5, 1.5, 1),
      volume: numeric(readPreference("zr-volume", "1"), 0, 1, 1),
    };
    this.state = "idle";
    this.session = 0;
    this.version = 0;
    this.current = null;
    this.voices = [];
    this.updateVoices = () => {
      this.voices = this.engine?.getVoices() || [];
      this.emit();
    };
    this.engine?.addEventListener("voiceschanged", this.updateVoices);
    this.updateVoices();
  }
  emit() {
    this.onChange(this);
  }
  voiceFor(text) {
    return (
      this.voices.find((v) => v.voiceURI === this.settings.voice) ||
      this.voices.find(
        (v) =>
          v.localService &&
          v.lang
            .toLowerCase()
            .startsWith(/[\u3400-\u9fff]/u.test(text) ? "zh" : "en"),
      ) ||
      this.voices.find((v) =>
        v.lang
          .toLowerCase()
          .startsWith(/[\u3400-\u9fff]/u.test(text) ? "zh" : "en"),
      ) ||
      this.voices.find((v) => v.default) ||
      this.voices[0]
    );
  }
  async start(sections, label) {
    if (!this.supported) {
      this.onError(
        "当前浏览器不支持语音朗读，请使用支持系统语音的桌面浏览器。",
      );
      return;
    }
    this.stop();
    this.label = label;
    this.state = "loading";
    this.spoken = 0;
    const session = this.session;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    const source = typeof sections === "function" ? sections(signal) : sections;
    this.iterator = (async function* () {
      for await (const section of source) {
        if (signal.aborted) return;
        const chunks = splitSpeechText(section.text);
        for (let index = 0; index < chunks.length; index++) {
          if (signal.aborted) return;
          yield {
            ...section,
            text: chunks[index],
            index: index + 1,
            count: chunks.length,
          };
        }
      }
    })();
    this.emit();
    await this.advance(session);
  }
  async advance(session) {
    if (session !== this.session) return;
    this.current = null;
    this.utterance = null;
    if (this.state !== "paused") this.state = "loading";
    this.emit();
    try {
      const item = await this.iterator.next();
      if (session !== this.session) return;
      if (item.done) {
        this.state = this.spoken ? "finished" : "empty";
        this.emit();
        if (!this.spoken)
          this.onError(
            "没有可朗读的文字。扫描版 PDF 需要先进行 OCR 文字识别。",
          );
        return;
      }
      this.current = item.value;
      if (this.state !== "paused") this.speakCurrent();
      else this.emit();
    } catch (error) {
      if (session !== this.session) return;
      this.stop();
      this.state = "error";
      this.emit();
      this.onError(error.message || "文字提取失败，请重新打开书籍后重试。");
    }
  }
  speakCurrent() {
    if (!this.current) return;
    clearTimeout(this.startTimer);
    const session = this.session,
      version = ++this.version;
    const utterance = new this.Utterance(this.current.text);
    const voice = this.voiceFor(this.current.text);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else
      utterance.lang = /[\u3400-\u9fff]/u.test(this.current.text)
        ? "zh-CN"
        : "en-US";
    Object.assign(utterance, {
      rate: this.settings.rate,
      pitch: this.settings.pitch,
      volume: this.settings.volume,
    });
    this.utterance = utterance;
    this.state = "playing";
    const valid = () => session === this.session && version === this.version;
    utterance.onstart = () => {
      if (valid()) clearTimeout(this.startTimer);
    };
    utterance.onend = () => {
      if (valid()) {
        clearTimeout(this.startTimer);
        this.spoken++;
        this.advance(session);
      }
    };
    utterance.onerror = (e) => {
      if (!valid()) return;
      this.stop();
      this.state = "error";
      this.emit();
      const messages = {
        "not-allowed":
          "浏览器阻止了声音播放，请再次点击朗读并检查网站声音权限。",
        "voice-unavailable": "这个声音目前不可用，请选择其他声音。",
        network: "在线声音连接失败，请检查网络或选择本地声音。",
      };
      this.onError(
        messages[e.error] ||
          "语音播放失败。请检查电脑的语音包、音量，或更换声音和浏览器重试。",
      );
    };
    this.emit();
    this.startTimer = setTimeout(() => {
      if (valid() && this.state !== "paused")
        utterance.onerror({ error: "voice-unavailable" });
    }, 8000);
    try {
      this.engine.resume();
      this.engine.speak(utterance);
    } catch {
      utterance.onerror({ error: "synthesis-failed" });
    }
  }
  togglePause() {
    if (this.state === "paused") {
      if (this.utterance) {
        this.state = "playing";
        this.engine.resume();
      } else if (this.current) this.speakCurrent();
      else this.state = "loading";
    } else if (["playing", "loading"].includes(this.state)) {
      this.state = "paused";
      this.engine.pause();
    }
    this.emit();
  }
  setSettings(update) {
    if ("voice" in update) this.settings.voice = String(update.voice);
    for (const [key, min, max] of [
      ["rate", 0.5, 2],
      ["pitch", 0.5, 1.5],
      ["volume", 0, 1],
    ])
      if (key in update) this.settings[key] = numeric(update[key], min, max, 1);
    for (const [key, value] of Object.entries(this.settings))
      savePreference(`zr-${key}`, value);
    if (this.current && ["playing", "paused"].includes(this.state)) {
      const paused = this.state === "paused";
      ++this.version;
      this.engine.cancel();
      this.utterance = null;
      if (!paused) this.speakCurrent();
    }
    this.emit();
  }
  stop() {
    clearTimeout(this.startTimer);
    ++this.session;
    ++this.version;
    this.abort?.abort();
    this.iterator?.return?.().catch(() => {});
    this.engine?.cancel();
    this.engine?.resume();
    this.utterance = null;
    this.current = null;
    this.state = "idle";
    this.emit();
  }
  destroy() {
    this.stop();
    this.engine?.removeEventListener("voiceschanged", this.updateVoices);
  }
}
