import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { once } from "node:events";
import {
  Nutstore,
  parseListing,
  safeDavUrl,
  readArchive,
} from "../server/nutstore.mjs";
import { createBridge } from "../server/index.mjs";
const root = "https://dav.jianguoyun.com/dav/zotero/";
function response(path, { folder = false, status = 200 } = {}) {
  return `<d:response><d:href>${path}</d:href><d:propstat><d:prop><d:resourcetype>${folder ? "<d:collection/>" : ""}</d:resourcetype><d:getcontentlength>123</d:getcontentlength><d:getetag>etag-1</d:getetag></d:prop><d:status>HTTP/1.1 ${status} OK</d:status></d:propstat></d:response>`;
}
const xml = (entries) =>
  `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${entries.join("")}</d:multistatus>`;
const listing = xml([
  response("/dav/zotero/", { folder: true }),
  response("/dav/zotero/ABCD1234.zip"),
  response("/dav/zotero/ABCD1234.prop"),
  response("/dav/zotero/Paper%20%E8%AE%BA%E6%96%87.pdf"),
  response("/dav/zotero/sub/", { folder: true }),
]);
async function zip() {
  const zip = new JSZip();
  zip.file(
    Buffer.from("中文论文.pdf").toString("base64") + "%ZB64",
    "%PDF-1.4 test",
  );
  zip.file("snapshot.html", "not a paper");
  return zip.generateAsync({ type: "nodebuffer" });
}

test("WebDAV XML recognizes Zotero archives, Unicode PDFs and folders without following foreign hrefs", () => {
  const r = parseListing(listing, root);
  assert.deepEqual(
    r.entries.map((r) => r.name),
    ["sub", "ABCD1234.zip", "Paper 论文.pdf"],
  );
  assert.equal(r.possiblyTruncated, false);
  assert.equal(
    parseListing(
      xml([
        response("https://evil.example/a.pdf"),
        response("/dav/other/secret.pdf"),
        response("/dav/zotero/denied.pdf", { status: 403 }),
      ]),
      root,
    ).entries.length,
    0,
  );
  for (const url of [
    "http://127.0.0.1/dav/",
    "https://dav.jianguoyun.com.evil.test/dav/",
    "https://u:p@dav.jianguoyun.com/dav/",
    "https://dav.jianguoyun.com/dav/%2e%2e%2fsecret",
  ])
    assert.throws(() => safeDavUrl(url));
  assert.throws(() =>
    parseListing(
      '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><x/>',
      root,
    ),
  );
  assert.equal(
    parseListing(
      xml(
        Array.from({ length: 750 }, (_, i) =>
          response(`/dav/zotero/${i}.prop`),
        ),
      ),
      root,
    ).possiblyTruncated,
    true,
  );
});
test("Zotero ZIP decoding reads only selected PDF, rejects missing or unsafe names", async () => {
  const buffer = await zip();
  const entries = await readArchive(buffer);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "中文论文.pdf");
  assert.equal(
    (await readArchive(buffer, entries[0].entry)).data.toString(),
    "%PDF-1.4 test",
  );
  await assert.rejects(readArchive(buffer, "missing.pdf"));
  await assert.rejects(readArchive(Buffer.from("bad zip")));
  const bad = new JSZip();
  bad.file(Buffer.from("../escape.pdf").toString("base64") + "%ZB64", "bad");
  await assert.rejects(
    readArchive(await bad.generateAsync({ type: "nodebuffer" })),
    /不安全/,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(readArchive(buffer, undefined, abort.signal), /停止/);
});
test("Nutstore validates credentials with PROPFIND, caches ZIP once, never exposes password and forbids remote writes", async () => {
  const calls = [],
    buffer = await zip();
  const cloud = new Nutstore({
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        method: init.method,
        redirect: init.redirect,
      });
      return new Response(init.method === "PROPFIND" ? listing : buffer, {
        status: init.method === "PROPFIND" ? 207 : 200,
      });
    },
  });
  await cloud.connect({
    username: "test@example.com",
    password: "test-secret",
    directory: root,
  });
  assert.equal(cloud.status().connected, true);
  assert.equal(JSON.stringify(cloud.status()).includes("test-secret"), false);
  const entries = (await cloud.contents("/dav/zotero/ABCD1234.zip")).entries;
  await cloud.file("/dav/zotero/ABCD1234.zip", entries[0].entry);
  assert.equal(calls.filter((c) => c.method === "GET").length, 1);
  assert.ok(
    calls.every(
      (c) => ["PROPFIND", "GET"].includes(c.method) && c.redirect === "manual",
    ),
  );
  await assert.rejects(cloud.file("/dav/other/private.pdf"), /所连接/);
  cloud.disconnect();
  assert.equal(cloud.cache, null);
  assert.equal(cloud.config, null);
  await assert.rejects(cloud.list(root), /先连接/);
});
test("failed auth and redirect errors do not leak credentials or follow redirects", async () => {
  for (const status of [401, 302]) {
    const cloud = new Nutstore({
      fetchImpl: async () =>
        new Response("", {
          status,
          headers: { Location: "https://evil.example" },
        }),
    });
    await assert.rejects(
      cloud.connect({
        username: "test@example.com",
        password: "super-secret",
        directory: root,
      }),
      (e) => !e.message.includes("super-secret"),
    );
    assert.equal(cloud.status().connected, false);
  }
});
test("authenticated bridge returns binary paper and safe filename; cloud endpoints require pairing", async (t) => {
  const cloud = {
    status: () => ({ connected: true }),
    disconnect() {},
    file: async () => ({ name: "中文.pdf", data: Buffer.from("%PDF test") }),
  };
  const server = createBridge({
    cloud,
    client: { close() {} },
    token: "a".repeat(64),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + "/api/cloud/status")).status, 401);
  const res = await fetch(base + "/api/cloud/file", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + "a".repeat(64),
      Origin: "https://wongjemoment.github.io",
    },
    body: JSON.stringify({ path: "/dav/zotero/a.pdf" }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("X-File-Name"), encodeURIComponent("中文.pdf"));
  assert.equal(await res.text(), "%PDF test");
});
