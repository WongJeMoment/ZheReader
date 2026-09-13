import { DOMParser } from "@xmldom/xmldom";
import yauzl from "yauzl";
const ORIGIN = "https://dav.jianguoyun.com";
const MAX = 250 * 1024 * 1024;
const error = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export function safeDavUrl(value, base = ORIGIN + "/dav/") {
  let url;
  try {
    url = new URL(value, base);
  } catch {
    throw error("坚果云目录地址无效。");
  }
  if (
    url.origin !== ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw error("只支持 https://dav.jianguoyun.com/dav/ 下的目录。");
  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    throw error("目录编码无效。");
  }
  if (
    !decoded.startsWith("/dav/") ||
    /[\\\x00-\x1f]/.test(decoded) ||
    decoded.split("/").some((p) => p === "." || p === "..")
  )
    throw error("目录路径无效。");
  return url;
}
export function parseListing(xml, directory) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw error("不支持的目录 XML。", 502);
  let malformed = false;
  const doc = new DOMParser({
    onError: () => {
      malformed = true;
    },
  }).parseFromString(xml, "application/xml");
  if (malformed || doc.documentElement?.localName !== "multistatus")
    throw error("坚果云返回了无效的目录。", 502);
  const nodes = Array.from(doc.getElementsByTagNameNS("DAV:", "response"));
  const rows = new Map();
  const base = safeDavUrl(directory);
  for (const node of nodes) {
    const href = node.getElementsByTagNameNS("DAV:", "href")[0]?.textContent;
    if (!href) continue;
    let url;
    try {
      url = safeDavUrl(href, base);
    } catch {
      continue;
    }
    if (
      !url.pathname.startsWith(base.pathname) ||
      url.pathname === base.pathname
    )
      continue;
    const relative = url.pathname
      .slice(base.pathname.length)
      .replace(/\/$/, "");
    if (!relative || relative.includes("/")) continue;
    const propstats = Array.from(
      node.getElementsByTagNameNS("DAV:", "propstat"),
    );
    const good = propstats.find((p) =>
      /\s200(?:\s|$)/.test(
        p.getElementsByTagNameNS("DAV:", "status")[0]?.textContent || "",
      ),
    );
    if (!good) continue;
    const get = (name) =>
      good.getElementsByTagNameNS("DAV:", name)[0]?.textContent || "";
    const folder = good.getElementsByTagNameNS("DAV:", "collection").length > 0;
    const name = decodeURIComponent(relative);
    if (!folder && !/\.(zip|pdf|epub)$/i.test(name)) continue;
    rows.set(url.pathname, {
      path: url.pathname,
      name,
      kind: folder ? "folder" : /\.zip$/i.test(name) ? "archive" : "file",
      size: Number(get("getcontentlength")) || 0,
      etag: get("getetag"),
      modified: get("getlastmodified"),
    });
  }
  return {
    entries: [...rows.values()].sort(
      (a, b) =>
        (a.kind === "folder" ? -1 : 0) - (b.kind === "folder" ? -1 : 0) ||
        a.name.localeCompare(b.name),
    ),
    possiblyTruncated: nodes.length >= 750,
  };
}
async function readLimited(stream, limit, signal) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    signal?.throwIfAborted();
    size += chunk.length;
    if (size > limit)
      throw error("文件超过 250 MB 或目录过大，请分批处理。", 413);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export function archiveName(name) {
  if (name.endsWith("%ZB64"))
    name = Buffer.from(name.slice(0, -5), "base64").toString("utf8");
  if (
    /[\\\x00-\x1f]/.test(name) ||
    name.startsWith("/") ||
    name.split("/").includes("..")
  )
    throw error("附件包包含不安全的文件名。");
  return name;
}
export function readArchive(buffer, selected, signal) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (err, zip) => {
        if (err) {
          reject(error("Zotero 附件包损坏或不是 ZIP。"));
          return;
        }
        let finished = false,
          count = 0,
          total = 0;
        const entries = [];
        const finish = (err, value) => {
          if (finished) return;
          finished = true;
          signal?.removeEventListener("abort", cancel);
          zip.close();
          err ? reject(err) : resolve(value);
        };
        const cancel = () => finish(error("下载已停止。"));
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) {
          cancel();
          return;
        }
        zip.on("error", () => finish(error("无法解压此附件包。")));
        zip.on("end", () =>
          finish(
            selected === undefined ? null : error("附件包中没有这个文件。"),
            entries,
          ),
        );
        zip.on("entry", (entry) => {
          try {
            if (++count > 2000 || (total += entry.uncompressedSize) > MAX * 2)
              throw error("附件包内容过多，请使用较小的附件。", 413);
            const name = archiveName(entry.fileName);
            if (/\.(pdf|epub)$/i.test(name) && !name.startsWith("__MACOSX/")) {
              if (entry.uncompressedSize > MAX)
                throw error("附件超过 250 MB。", 413);
              if (entry.generalPurposeBitFlag & 1)
                throw error("不支持加密的 ZIP 附件。");
              entries.push({
                entry: entry.fileName,
                name: name.split("/").pop(),
                size: entry.uncompressedSize,
              });
              if (selected === entry.fileName) {
                zip.openReadStream(entry, (err, stream) => {
                  if (err) {
                    finish(error("无法读取附件。"));
                    return;
                  }
                  const destroy = () => stream.destroy(error("下载已停止。"));
                  signal?.addEventListener("abort", destroy, { once: true });
                  readLimited(stream, MAX, signal)
                    .then(
                      (data) =>
                        finish(null, { data, name: name.split("/").pop() }),
                      (e) => finish(e),
                    )
                    .finally(() =>
                      signal?.removeEventListener("abort", destroy),
                    );
                });
                return;
              }
            }
            zip.readEntry();
          } catch (e) {
            finish(e);
          }
        });
        zip.readEntry();
      },
    );
  });
}
export class Nutstore {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetch = fetchImpl;
    this.config = null;
    this.cache = null;
    this.active = new Set();
    this.revision = 0;
  }
  status() {
    return this.config
      ? {
          connected: true,
          username: this.config.username,
          directory: this.config.directory,
        }
      : { connected: false };
  }
  disconnect() {
    this.revision++;
    for (const abort of this.active) abort.abort();
    this.config = null;
    this.cache = null;
    return this.status();
  }
  async connect(input, signal) {
    if (
      !input ||
      typeof input.username !== "string" ||
      !input.username.trim() ||
      input.username.length > 320 ||
      input.username.includes(":") ||
      typeof input.password !== "string" ||
      !input.password ||
      input.password.length > 1024
    )
      throw error("请输入坚果云账号和应用密码。");
    const directory = safeDavUrl(input.directory || ORIGIN + "/dav/zotero/");
    if (!directory.pathname.endsWith("/")) directory.pathname += "/";
    const config = {
      username: input.username.trim(),
      password: input.password,
      directory: directory.href,
    };
    const revision = this.revision;
    const listing = await this.listWith(config, directory.href, signal);
    if (revision !== this.revision) throw error("连接已取消，请重试。");
    this.disconnect();
    this.config = config;
    return { ...this.status(), ...listing };
  }
  target(path, config = this.config) {
    if (!config) throw error("请先连接坚果云。", 401);
    const url = safeDavUrl(path || config.directory, config.directory);
    if (!url.pathname.startsWith(new URL(config.directory).pathname))
      throw error("只能访问所连接的目录。");
    return url;
  }
  async request(config, url, method, signal) {
    const controller = new AbortController();
    this.active.add(controller);
    const combined = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(120000),
      ...(signal ? [signal] : []),
    ]);
    try {
      const response = await this.fetch(url, {
        method,
        redirect: "manual",
        signal: combined,
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${config.username}:${config.password}`).toString(
              "base64",
            ),
          ...(method === "PROPFIND"
            ? { Depth: "1", "Content-Type": "application/xml; charset=utf-8" }
            : {}),
        },
        ...(method === "PROPFIND"
          ? {
              body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getetag/><d:getlastmodified/></d:prop></d:propfind>',
            }
          : {}),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw error(
          response.status === 401 || response.status === 403
            ? "坚果云验证失败，请检查账号、应用密码与目录权限。"
            : response.status === 404
              ? "目录或附件不存在。Zotero 默认目录为 /dav/zotero/。"
              : response.status === 429
                ? "坚果云访问频率受限，请稍后重试。"
                : response.status >= 300 && response.status < 400
                  ? "坚果云返回了跳转地址，请检查目录设置。"
                  : `坚果云请求失败（${response.status}）。`,
          502,
        );
      }
      return await readLimited(
        response.body,
        method === "PROPFIND" ? 8 * 1024 * 1024 : MAX,
        combined,
      );
    } catch (e) {
      if (e.status) throw e;
      throw error(
        combined.aborted
          ? "请求已停止或超时，请重试。"
          : "无法连接坚果云，请检查网络。",
        502,
      );
    } finally {
      this.active.delete(controller);
    }
  }
  async listWith(config, path, signal) {
    const url = this.target(path, config);
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    const data = await this.request(config, url, "PROPFIND", signal);
    return {
      directory: url.pathname,
      ...parseListing(data.toString("utf8"), url.href),
    };
  }
  async list(path, signal) {
    this.cache = null;
    return this.listWith(this.config, path, signal);
  }
  async archive(path, signal) {
    const config = this.config,
      url = this.target(path, config);
    if (!/\.zip$/i.test(url.pathname)) throw error("请选择 Zotero ZIP 附件。");
    if (this.cache?.path === url.pathname) return this.cache;
    const revision = this.revision;
    const buffer = await this.request(config, url, "GET", signal);
    const entries = await readArchive(buffer, undefined, signal);
    if (revision !== this.revision) throw error("连接已更改，请重新获取附件。");
    return (this.cache = { path: url.pathname, buffer, entries });
  }
  async contents(path, signal) {
    return { entries: (await this.archive(path, signal)).entries };
  }
  async file(path, entry, signal) {
    const config = this.config,
      url = this.target(path, config);
    if (/\.zip$/i.test(url.pathname)) {
      if (typeof entry !== "string") throw error("请先选择附件包中的 PDF。");
      const archive = await this.archive(path, signal);
      return readArchive(archive.buffer, entry, signal);
    }
    if (!/\.(pdf|epub)$/i.test(url.pathname))
      throw error("仅支持 PDF、EPUB 和 Zotero 附件包。");
    return {
      name: decodeURIComponent(url.pathname.split("/").pop()),
      data: await this.request(config, url, "GET", signal),
    };
  }
}
