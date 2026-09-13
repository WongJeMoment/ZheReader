import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import JSZip from "jszip";
import {
  validateAnnotation,
  collectionPaths,
  inCollection,
} from "../shared/annotations.js";
import { ZoteroBridge } from "../server/zotero.mjs";
const annotation = {
  key: "ABCD2345",
  type: "highlight",
  text: "Hello",
  comment: "理解",
  color: "#ffd400",
  pageLabel: "1",
  sortIndex: "00000|000000|00012",
  position: { pageIndex: 0, rects: [[12, 20, 60, 32]] },
};
const bytes = Buffer.from("%PDF matching file"),
  fileHash = createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const context = vm.createContext({ Uint8Array, Date, JSON, Map, Set });
  vm.runInContext(
    (await readFile("shared/annotations.js", "utf8")).replace(/^export /gm, ""),
    context,
  );
  vm.runInContext(await readFile("zotero-addon/bridge.js", "utf8"), context);
  const stored = new Map(),
    prefs = new Map();
  let saves = 0,
    deletes = 0;
  const attachment = {
    id: 1,
    key: "ATTACH23",
    libraryID: 1,
    parentID: 2,
    attachmentContentType: "application/pdf",
    attachmentFilename: "paper.pdf",
    isAttachment: () => true,
    getFilePathAsync: async () => "/paper.pdf",
    getTags: () => [{ tag: "机器学习" }],
    loadAllData: async () => {},
  };
  const parent = {
    id: 2,
    key: "PARENT23",
    isAttachment: () => false,
    getField: () => "Paper title",
    getCollections: () => [2],
    getTags: () => [{ tag: "机器学习" }],
    loadAllData: async () => {},
  };
  const collections = [
    { id: 1, key: "COLLECT2", name: "Research", parentID: null },
    { id: 2, key: "COLLECT3", name: "Nested", parentID: 1 },
  ];
  const Zotero = {
    version: "9.0.1",
    Server: { Endpoints: {} },
    Users: { getLocalUserKey: () => "database-key" },
    getMainWindow: () => ({ crypto: webcrypto, TextEncoder }),
    Libraries: { userLibraryID: 1 },
    Collections: {
      getByLibrary: (id, recursive) => {
        assert.equal(recursive, true);
        return collections;
      },
      get: (id) => collections.find((c) => c.id === id),
    },
    Items: {
      getAll: async () => [attachment, parent],
      get: (id) => (id === 2 ? parent : attachment),
      getByLibraryAndKeyAsync: async (id, key) =>
        key === attachment.key ? attachment : stored.get(key),
    },
    Annotations: {
      toJSON: async (item) => item.json,
      saveFromJSON: async (att, json) => {
        saves++;
        stored.set(json.key, {
          isAnnotation: () => true,
          parentID: att.id,
          annotationIsExternal: false,
          getTags: () => [{ tag: "机器学习" }],
          loadAllData: async () => {},
          json: structuredClone(json),
          eraseTx: async () => {
            deletes++;
            stored.delete(json.key);
          },
        });
      },
    },
  };
  const Services = {
    prefs: {
      getStringPref: (k) => prefs.get(k) || "",
      setStringPref: (k, v) => prefs.set(k, v),
    },
    uuid: { generateUUID: () => "{instance}" },
    prompt: { confirm: () => true },
  };
  const plugin = new context.ZheReaderZoteroBridge({
    Zotero,
    Services,
    IOUtils: {
      stat: async () => ({ size: bytes.length }),
      read: async () => bytes,
    },
    protocol: context,
  });
  plugin.start();
  const call = async (action, data = {}, extra = {}) => {
    const [code, , body] = await plugin.handle(action, {
      headers: {
        host: "127.0.0.1:23119",
        "x-zhereader-token": plugin.token,
        ...extra,
      },
      data: { instance: plugin.instance(), ...data },
    });
    return { code, ...JSON.parse(body) };
  };
  await call("pair");
  return { plugin, call, stored, Zotero, counts: () => ({ saves, deletes }) };
}
test("collection nesting and multiple membership retain Zotero hierarchy", () => {
  const c = [
    { key: "a", name: "A" },
    { key: "b", name: "B", parentKey: "a" },
    { key: "c", name: "C" },
  ];
  assert.equal(collectionPaths(c)[1].path, "A / B");
  assert.equal(inCollection(["b", "c"], "a", c), true);
  assert.equal(inCollection(["c"], "a", c), false);
  assert.throws(() =>
    validateAnnotation({
      ...annotation,
      position: { pageIndex: 0, rects: [[0, 0, Infinity, 1]] },
    }),
  );
});
test("plugin endpoints require pairing, reject web origins and unregister on shutdown", async () => {
  const { plugin, call, Zotero } = await fixture();
  assert.equal(
    (await call("catalog", {}, { "x-zhereader-token": "wrong" })).code,
    401,
  );
  assert.equal(
    (await call("catalog", {}, { origin: "https://evil.example" })).code,
    403,
  );
  assert.equal((await call("catalog", { instance: "other" })).code, 409);
  const catalog = await call("catalog");
  assert.equal(catalog.attachments[0].title, "Paper title");
  assert.deepEqual(catalog.attachments[0].tags, ["机器学习"]);
  assert.equal(catalog.collections.length, 2);
  assert.equal(catalog.attachments[0].collections[0], "COLLECT3");
  plugin.stop();
  assert.equal(Object.keys(Zotero.Server.Endpoints).length, 0);
});
test("native annotation sync verifies PDF, retries idempotently, detects remote edits and handles deletion", async () => {
  const { call, stored, counts } = await fixture();
  const payload = { attachmentKey: "ATTACH23", fileHash, annotation };
  assert.equal(
    (await call("sync", { ...payload, fileHash: "f".repeat(64) })).code,
    400,
  );
  assert.equal(counts().saves, 0);
  const first = await call("sync", payload);
  assert.equal(first.code, 200);
  assert.equal(first.base.length, 64);
  assert.equal(counts().saves, 1);
  assert.equal((await call("sync", payload)).unchanged, true);
  assert.equal(counts().saves, 1);
  const changed = { ...annotation, comment: "Revised" };
  const second = await call("sync", {
    ...payload,
    annotation: changed,
    base: first.base,
  });
  assert.equal(second.code, 200);
  stored.get(annotation.key).json.comment = "Edited in Zotero";
  assert.equal(
    (
      await call("sync", {
        ...payload,
        annotation: { ...changed, comment: "Local" },
        base: second.base,
      })
    ).code,
    409,
  );
  const remote = await call("read", {
    attachmentKey: "ATTACH23",
    fileHash,
    key: annotation.key,
  });
  assert.equal(remote.annotation.comment, "Edited in Zotero");
  assert.equal(
    (
      await call("sync", {
        attachmentKey: "ATTACH23",
        fileHash,
        key: annotation.key,
        deleted: true,
        base: second.base,
      })
    ).code,
    409,
  );
  assert.equal(
    (
      await call("sync", {
        attachmentKey: "ATTACH23",
        fileHash,
        key: annotation.key,
        deleted: true,
        base: remote.base,
      })
    ).deleted,
    true,
  );
  assert.equal(
    (
      await call("sync", {
        attachmentKey: "ATTACH23",
        fileHash,
        key: annotation.key,
        deleted: true,
        base: remote.base,
      })
    ).deleted,
    true,
  );
  assert.equal(counts().deletes, 1);
});
test("local service keeps Zotero token private and sends only constrained annotation operations", async () => {
  const calls = [];
  const bridge = new ZoteroBridge({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify(
          url.endsWith("/pair")
            ? { token: "b".repeat(64), instance: "i" }
            : { available: true },
        ),
        { status: 200 },
      );
    },
  });
  assert.deepEqual(await bridge.pair(), { connected: true, instance: "i" });
  assert.equal(
    JSON.stringify(await bridge.status()).includes("b".repeat(64)),
    false,
  );
  await bridge.annotation({
    instance: "i",
    attachmentKey: "ATTACH23",
    fileHash,
    annotation,
  });
  assert.equal(calls.at(-1).url, "http://127.0.0.1:23119/zhereader/sync");
  assert.equal(calls.at(-1).init.headers["X-ZheReader-Token"], "b".repeat(64));
  await assert.rejects(
    bridge.annotation({
      instance: "other",
      attachmentKey: "ATTACH23",
      fileHash,
      annotation,
    }),
  );
});
test("installable XPI contains manifest and loadable shared validation and bridge scripts", async () => {
  const archive = await readFile("public/downloads/zhereader-zotero.xpi");
  const zip = await JSZip.loadAsync(archive);
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  assert.equal(manifest.applications.zotero.strict_max_version, "9.0.*");
  const app = manifest.applications.zotero;
  assert.equal(
    app.update_url,
    "https://wongjemoment.github.io/ZheReader/downloads/zotero-updates.json",
  );
  const updates = JSON.parse(
    await readFile("public/downloads/zotero-updates.json", "utf8"),
  );
  const update = updates.addons[app.id].updates[0];
  assert.equal(update.version, manifest.version);
  assert.equal(
    update.update_link,
    new URL("zhereader-zotero.xpi", app.update_url).href,
  );
  assert.equal(
    update.update_hash,
    "sha256:" + createHash("sha256").update(archive).digest("hex"),
  );
  assert.deepEqual(update.applications.zotero, {
    strict_min_version: app.strict_min_version,
    strict_max_version: app.strict_max_version,
  });
  const context = vm.createContext({});
  vm.runInContext(await zip.file("annotations.js").async("string"), context);
  vm.runInContext(await zip.file("bridge.js").async("string"), context);
  assert.equal(typeof context.validateAnnotation, "function");
  assert.equal(typeof context.ZheReaderZoteroBridge, "function");
});
