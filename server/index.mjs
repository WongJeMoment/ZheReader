import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexClient } from "./codex-client.mjs";
const defaultDist = fileURLToPath(new URL("../dist/", import.meta.url));
const hostedOrigin = "https://wongjemoment.github.io";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".epub": "application/epub+zip",
  ".woff2": "font/woff2",
};
function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    chunks.push(chunk);
    size += chunk.length;
    if (size > 65536)
      throw Object.assign(new Error("选区过长，请分段翻译。"), { status: 413 });
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("请求内容无效"), { status: 400 });
  }
}
export function createBridge({
  client = new CodexClient(),
  distDir = defaultDist,
  token = randomBytes(32).toString("hex"),
} = {}) {
  const server = createServer(async (req, res) => {
    const port = server.address().port;
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) {
      json(res, 403, { error: "只允许本机连接" });
      return;
    }
    const url = new URL(req.url, `http://${host}`);
    const localOrigin = `http://${host}`;
    const allowed = [
      hostedOrigin,
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
    ];
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
      if (origin && !allowed.includes(origin)) {
        json(res, 403, { error: "不允许的网站来源" });
        return;
      }
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization",
      );
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (url.pathname === "/health") {
        json(res, 200, { name: "ZheReader Bridge", version: 1 });
        return;
      }
      const supplied = String(req.headers.authorization || "").replace(
        /^Bearer /,
        "",
      );
      if (
        Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
      ) {
        json(res, 401, {
          error: "请重新连接本机服务。",
          code: "PAIR_REQUIRED",
        });
        return;
      }
      try {
        if (url.pathname === "/api/account" && req.method === "GET") {
          json(res, 200, await client.account());
          return;
        }
        if (url.pathname === "/api/login" && req.method === "POST") {
          json(res, 200, await client.login());
          return;
        }
        if (url.pathname === "/api/logout" && req.method === "POST") {
          json(res, 200, await client.logout());
          return;
        }
        if (url.pathname === "/api/models" && req.method === "GET") {
          json(res, 200, {
            models: (await client.models()).map((m) => ({
              id: m.model,
              name: m.displayName,
              isDefault: m.isDefault,
              hidden: Boolean(m.hidden),
              description: m.description || "",
            })),
          });
          return;
        }
        if (url.pathname === "/api/limits" && req.method === "GET") {
          json(res, 200, await client.rateLimits());
          return;
        }
        if (url.pathname === "/api/study" && req.method === "POST") {
          const input = await body(req);
          if (
            !input ||
            !["translate", "analyze", "explain", "research"].includes(
              input.action,
            ) ||
            typeof input.text !== "string" ||
            !input.text.trim() ||
            input.text.length > 8000 ||
            typeof (input.question || "") !== "string" ||
            (input.question || "").length > 1500 ||
            typeof (input.translation || "") !== "string" ||
            (input.translation || "").length > 16000
          ) {
            json(res, 400, {
              error: "请选择 1–8000 个字符；追问最多 1500 个字符。",
            });
            return;
          }
          const abort = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) abort.abort();
          });
          const result = await client.study(
            {
              action: input.action,
              text: input.text,
              question: input.question || "",
              translation: input.translation || "",
              model: typeof input.model === "string" ? input.model : undefined,
            },
            abort.signal,
          );
          if (!res.destroyed) json(res, 200, result);
          return;
        }
        json(res, 404, { error: "未知功能" });
      } catch (error) {
        if (!res.destroyed)
          json(res, error.status || 502, {
            error: error.message || "本地服务处理失败",
          });
      }
      return;
    }
    if (req.method !== "GET") {
      json(res, 405, { error: "Method not allowed" });
      return;
    }
    if (url.pathname === "/bridge/connect") {
      const requested = url.searchParams.get("origin");
      if (!allowed.includes(requested)) {
        json(res, 403, { error: "不允许连接此网站" });
        return;
      }
      const nonce = randomBytes(16).toString("hex");
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; frame-ancestors 'none'`,
      );
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(
        `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>连接 ZheReader</title><style>body{background:#f6f5f0;color:#303b32;font:16px/1.9 system-ui;max-width:460px;margin:12vh auto;padding:30px}h1{font-size:25px}button{background:#526b50;color:white;border:0;border-radius:8px;padding:14px 25px;font-size:16px;cursor:pointer}p{color:#6a7665}code{font-size:13px}</style><h1>连接你的阅读空间</h1><p>允许 ZheReader 网页使用这台电脑上的连接服务，进行账号登录、翻译和英语学习。账号凭据不会传给阅读网页。</p><p>网站：<code>${requested}</code></p><button id="connect">连接阅读网页</button><p id="status"></p><script nonce="${nonce}">document.getElementById('connect').onclick=()=>{if(!window.opener){document.getElementById('status').textContent='请从阅读网站点击“连接本机服务”打开此页。';return;}window.opener.postMessage({type:'zhereader:paired',token:${JSON.stringify(token)}},${JSON.stringify(requested)});document.getElementById('status').textContent='已连接，可以返回阅读网页。';window.close();};</script></html>`,
      );
      return;
    }
    try {
      const path = resolve(
        distDir,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
          ),
      );
      if (!path.startsWith(resolve(distDir) + sep)) {
        json(res, 403, { error: "Forbidden" });
        return;
      }
      if (!(await stat(path)).isFile()) throw new Error("not found");
      let content = await readFile(path);
      if (extname(path) === ".html") {
        const bootstrap = JSON.stringify({ base: localOrigin, token }).replace(
          /</g,
          "\\u003c",
        );
        content = content
          .toString()
          .replace(
            "</head>",
            `<script>window.__ZHEREADER_BRIDGE__=${bootstrap}</script></head>`,
          );
      }
      res.writeHead(200, {
        "Content-Type": mime[extname(path)] || "application/octet-stream",
        "Cache-Control":
          extname(path) === ".html" ? "no-store" : "public, max-age=3600",
      });
      res.end(content);
    } catch {
      json(res, 404, { error: "页面未构建。请先运行 npm run build。" });
    }
  });
  server.on("close", () => client.close());
  return server;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.ZHEREADER_PORT || 4318);
  const server = createBridge();
  server.on("error", (error) => {
    console.error(
      error.code === "EADDRINUSE"
        ? `端口 ${port} 已被占用，请检查是否已启动 ZheReader。`
        : error.message,
    );
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `ZheReader 本地连接已启动：http://127.0.0.1:${port}\n保持此终端运行，在阅读器中点击“GPT 账号”登录。\n在线阅读器也可通过“连接本机服务”配对。`,
    ),
  );
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
