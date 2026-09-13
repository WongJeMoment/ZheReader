var ZheReaderZoteroBridge = class {
  constructor({ Zotero, Services, IOUtils, protocol }) {
    Object.assign(this, { Zotero, Services, IOUtils, protocol });
    this.token = "";
    this.endpoints = [];
    this.lastPair = 0;
    this.busy = false;
  }
  async digest(value) {
    const win = this.Zotero.getMainWindow();
    const bytes =
      typeof value === "string" ? new win.TextEncoder().encode(value) : value;
    return Array.from(
      new Uint8Array(await win.crypto.subtle.digest("SHA-256", bytes)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
  }
  instance() {
    const key = "extensions.zhereader.instance";
    let id = this.Services.prefs.getStringPref(key, "");
    if (!id) {
      id = this.Services.uuid.generateUUID().toString();
      this.Services.prefs.setStringPref(key, id);
    }
    return id + ":" + this.Zotero.Users.getLocalUserKey();
  }
  start() {
    for (const action of ["status", "pair", "catalog", "sync", "read"]) {
      const bridge = this,
        path = "/zhereader/" + action;
      const Endpoint = function () {};
      Endpoint.prototype = {
        supportedMethods: action === "status" ? ["GET"] : ["POST"],
        supportedDataTypes: ["application/json"],
        permitBookmarklet: false,
        async init(request) {
          return bridge.handle(action, request);
        },
      };
      this.Zotero.Server.Endpoints[path] = Endpoint;
      this.endpoints.push([path, Endpoint]);
    }
  }
  stop() {
    this.token = "";
    for (const [path, Endpoint] of this.endpoints)
      if (this.Zotero.Server.Endpoints[path] === Endpoint)
        delete this.Zotero.Server.Endpoints[path];
    this.endpoints = [];
  }
  async handle(action, { headers = {}, data }) {
    const result = (code, value) => [
      code,
      "application/json",
      JSON.stringify(value),
    ];
    try {
      if (
        headers.origin ||
        !["localhost:23119", "127.0.0.1:23119"].includes(headers.host)
      )
        return result(403, { error: "仅允许本机连接服务。" });
      if (action === "status")
        return result(200, {
          available: true,
          version: "1.0.2",
          zoteroVersion: this.Zotero.version,
        });
      if (action === "pair") {
        if (Date.now() - this.lastPair < 10000)
          return result(429, { error: "请稍候再连接。" });
        this.lastPair = Date.now();
        const allow = this.Services.prompt.confirm(
          this.Zotero.getMainWindow(),
          "连接 ZheReader",
          "允许本机 ZheReader 读取个人文库分类和附件信息，并将你在阅读器保存的高亮、下划线与评论同步到 Zotero 吗？\n连接凭证仅保存在本机服务内存中，禁用此插件可撤销连接。",
        );
        if (!allow) return result(403, { error: "你在 Zotero 中取消了连接。" });
        const bytes = new Uint8Array(32);
        this.Zotero.getMainWindow().crypto.getRandomValues(bytes);
        this.token = Array.from(bytes, (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        return result(200, { token: this.token, instance: this.instance() });
      }
      if (!this.token || headers["x-zhereader-token"] !== this.token)
        return result(401, { error: "请重新连接 Zotero 并确认授权。" });
      if (data?.instance !== this.instance())
        return result(409, {
          error: "Zotero 文库连接已更改，请重新关联分类。",
        });
      if (action === "catalog") return result(200, await this.catalog());
      if (this.busy)
        return result(409, { error: "另一条标注正在同步，请稍候重试。" });
      this.busy = true;
      try {
        return result(200, await this.annotation(action, data));
      } finally {
        this.busy = false;
      }
    } catch (error) {
      return result(error.status || 400, {
        error: error.message || "Zotero 处理失败。",
      });
    }
  }
  async catalog() {
    const Z = this.Zotero,
      libraryID = Z.Libraries.userLibraryID;
    const collections = Z.Collections.getByLibrary(libraryID, true).map(
      (c) => ({
        key: c.key,
        name: c.name,
        parentKey: c.parentID ? Z.Collections.get(c.parentID)?.key : null,
      }),
    );
    const items = await Z.Items.getAll(libraryID, false, false);
    const attachments = [];
    for (const item of items) {
      if (!item.isAttachment() || item.deleted) continue;
      await item.loadAllData();
      if (
        !item.isAttachment() ||
        item.deleted ||
        item.attachmentContentType !== "application/pdf"
      )
        continue;
      const parent = item.parentID ? Z.Items.get(item.parentID) : null;
      if (parent?.deleted) continue;
      const source = parent || item;
      if (parent) await parent.loadAllData();
      attachments.push({
        key: item.key,
        parentKey: parent?.key || null,
        title: source.getField("title") || item.getField("title"),
        filename: item.attachmentFilename || "",
        tags: [
          ...new Set(
            [...source.getTags(), ...item.getTags()]
              .map((t) => t.tag)
              .filter(Boolean),
          ),
        ],
        collections: source
          .getCollections()
          .map((id) => Z.Collections.get(id)?.key)
          .filter(Boolean),
      });
    }
    return { instance: this.instance(), collections, attachments };
  }
  async annotation(action, data) {
    const Z = this.Zotero;
    if (
      !/^[A-Z0-9]{8}$/.test(data.attachmentKey || "") ||
      !/^[a-f0-9]{64}$/.test(data.fileHash || "")
    )
      throw new Error("文献关联信息无效。");
    const attachment = await Z.Items.getByLibraryAndKeyAsync(
      Z.Libraries.userLibraryID,
      data.attachmentKey,
    );
    if (attachment?.isAttachment()) await attachment.loadAllData();
    if (
      !attachment ||
      attachment.deleted ||
      !attachment.isAttachment() ||
      attachment.attachmentContentType !== "application/pdf"
    )
      throw new Error("Zotero 中没有对应的 PDF 附件。");
    const path = await attachment.getFilePathAsync();
    if (!path)
      throw new Error("请先在 Zotero 中下载并打开此 PDF，再同步标注。");
    const stat = await this.IOUtils.stat(path);
    if (stat.size > 250 * 1024 * 1024) throw new Error("PDF 超过 250 MB。");
    if ((await this.digest(await this.IOUtils.read(path))) !== data.fileHash)
      throw new Error(
        "PDF 内容与 Zotero 不一致。请重新导入同一版本，未写入标注。",
      );
    const key = data.annotation?.key || data.key;
    if (!/^[A-Z2-9]{8}$/.test(key || "")) throw new Error("标注编号无效。");
    const existing = await Z.Items.getByLibraryAndKeyAsync(
      attachment.libraryID,
      key,
    );
    if (
      existing &&
      (!existing.isAnnotation() ||
        existing.parentID !== attachment.id ||
        existing.annotationIsExternal)
    )
      throw new Error("标注编号已被其他条目使用，未覆盖。");
    let remote, base;
    if (existing) {
      await existing.loadAllData();
      remote = await Z.Annotations.toJSON(existing);
      base = await this.digest(this.protocol.annotationValue(remote));
    }
    if (action === "read")
      return {
        annotation: remote ? this.protocol.validateAnnotation(remote) : null,
        base: base || null,
      };
    if (data.deleted) {
      if (!existing) return { key, deleted: true };
      if (data.base !== base)
        throw Object.assign(
          new Error("Zotero 标注已修改，未删除。请先采用 Zotero 版本。"),
          { status: 409 },
        );
      await existing.eraseTx();
      return { key, deleted: true };
    }
    const annotation = this.protocol.validateAnnotation(data.annotation);
    const desired = await this.digest(
      this.protocol.annotationValue(annotation),
    );
    if (existing && base === desired) return { key, base, unchanged: true };
    if (existing && data.base !== base)
      throw Object.assign(
        new Error("Zotero 标注已修改，未覆盖。请先采用 Zotero 版本。"),
        { status: 409 },
      );
    if (!existing && data.base)
      throw Object.assign(
        new Error("Zotero 中的标注已删除，未重新创建。请先采用 Zotero 版本。"),
        { status: 409 },
      );
    await Z.Annotations.saveFromJSON(attachment, {
      ...annotation,
      isExternal: false,
      authorName: remote?.authorName || "",
      tags: remote?.tags || [],
    });
    return { key, base: desired };
  }
};
