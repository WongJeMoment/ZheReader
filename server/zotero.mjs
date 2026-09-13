import { validateAnnotation } from "../shared/annotations.js";
const BASE = "http://127.0.0.1:23119/zhereader/";
export class ZoteroBridge {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetch = fetchImpl;
    this.token = "";
    this.instance = "";
  }
  async request(action, data, signal) {
    let res;
    try {
      res = await this.fetch(BASE + action, {
        method: action === "status" ? "GET" : "POST",
        redirect: "error",
        signal: AbortSignal.any([
          AbortSignal.timeout(action === "pair" ? 120000 : 90000),
          ...(signal ? [signal] : []),
        ]),
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { "X-ZheReader-Token": this.token } : {}),
        },
        ...(action === "status" ? {} : { body: JSON.stringify(data || {}) }),
      });
    } catch {
      throw new Error(
        "无法连接本机 Zotero。请保持 Zotero 开启，并安装 ZheReader 配套插件。",
      );
    }
    if (res.status === 404)
      throw new Error("请先在 Zotero 安装 ZheReader 配套插件，再连接。");
    let result;
    try {
      result = await res.json();
    } catch {
      throw new Error("Zotero 接口不可用，请检查配套插件是否启用。");
    }
    if (!res.ok) {
      if (res.status === 401) {
        this.token = "";
        this.instance = "";
      }
      throw Object.assign(new Error(result.error || "Zotero 请求失败。"), {
        status: res.status,
      });
    }
    return result;
  }
  async status() {
    const r = await this.request("status");
    return { ...r, connected: !!this.token, instance: this.instance };
  }
  async pair(signal) {
    const r = await this.request("pair", {}, signal);
    if (!/^[a-f0-9]{64}$/.test(r.token || "") || typeof r.instance !== "string")
      throw new Error("Zotero 连接响应无效。");
    this.token = r.token;
    this.instance = r.instance;
    return { connected: true, instance: r.instance };
  }
  async catalog(signal) {
    if (!this.token) throw new Error("请先连接 Zotero，并在 Zotero 窗口确认。");
    return this.request("catalog", { instance: this.instance }, signal);
  }
  async annotation(input, signal, read = false) {
    if (!this.token) throw new Error("请先连接 Zotero。");
    if (
      !input ||
      input.instance !== this.instance ||
      !/^[A-Z0-9]{8}$/.test(input.attachmentKey || "") ||
      !/^[a-f0-9]{64}$/.test(input.fileHash || "")
    )
      throw new Error("文献属于不同的 Zotero 连接，请刷新分类并重新关联。");
    if (!/^[A-Z2-9]{8}$/.test(input.key || input.annotation?.key || ""))
      throw new Error("标注编号无效。");
    const payload = {
      instance: this.instance,
      attachmentKey: input.attachmentKey,
      fileHash: input.fileHash,
      base: input.base || null,
    };
    if (read || input.deleted) {
      payload.key = input.key;
      payload.deleted = !!input.deleted;
    } else payload.annotation = validateAnnotation(input.annotation);
    return this.request(read ? "read" : "sync", payload, signal);
  }
}
