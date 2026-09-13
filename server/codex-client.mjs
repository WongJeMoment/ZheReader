import {
  guideSchema,
  guidePrompt,
  validateGuide,
} from "../shared/paper-guide.js";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  buildPrompt,
  tutorInstructions,
  resultSchema,
  validateResult,
} from "./prompts.mjs";

export class CodexClient {
  constructor({
    command = process.env.ZHEREADER_CODEX_BINARY || "codex",
    commandArgs = [],
    dataDir = join(homedir(), ".local", "share", "zhereader"),
    spawnProcess = spawn,
  } = {}) {
    Object.assign(this, { command, commandArgs, dataDir, spawnProcess });
    this.pending = new Map();
    this.listeners = new Set();
    this.nextId = 1;
    this.busy = false;
    this.activeStudies = 0;
  }
  async ensureStarted() {
    if (!this.starting)
      this.starting = this.start().catch((error) => {
        this.starting = null;
        throw error;
      });
    return this.starting;
  }
  async start() {
    const authDir = join(this.dataDir, "codex");
    this.workspace = join(this.dataDir, "workspace");
    await mkdir(authDir, { recursive: true, mode: 0o700 });
    await mkdir(this.workspace, { recursive: true, mode: 0o700 });
    const env = { ...process.env };
    for (const name of [
      "OPENAI_API_KEY",
      "CODEX_API_KEY",
      "OPENAI_BASE_URL",
      "OPENAI_ORG_ID",
      "OPENAI_PROJECT_ID",
      "CODEX_AUTH_TOKEN",
      "CODEX_ACCESS_TOKEN",
    ])
      delete env[name];
    // Configure the child CLI's documented home, without altering this process
    // or the user's existing Codex configuration/credentials.
    env.CODEX_HOME = authDir;
    this.proc = this.spawnProcess(
      this.command,
      [
        ...this.commandArgs,
        "app-server",
        "--stdio",
        "-c",
        'forced_login_method="chatgpt"',
        "-c",
        'model_provider="openai"',
        "-c",
        "features.shell_tool=false",
        "-c",
        "features.unified_exec=false",
        "-c",
        'history.persistence="none"',
      ],
      { cwd: this.workspace, env, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.proc.stderr.on("data", () => {});
    this.proc.stdin.on("error", () => {});
    this.proc.on("error", (error) =>
      this.failAll(
        new Error(
          error.code === "ENOENT"
            ? "未找到 Codex CLI。请先安装：npm install -g @openai/codex"
            : "无法启动本地 Codex 连接。",
        ),
      ),
    );
    this.proc.on("exit", () => {
      this.starting = null;
      this.failAll(new Error("Codex 连接已退出，请重试连接。"));
    });
    this.lines = createInterface({ input: this.proc.stdout });
    this.lines.on("line", (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.id !== undefined && msg.method) {
        // The reader never approves command execution, file edits, or extra tools.
        this.send({
          id: msg.id,
          error: {
            code: -32601,
            message:
              "This reading client does not allow tool approvals or external tool calls.",
          },
        });
        return;
      }
      if (msg.id !== undefined) {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);
        msg.error
          ? pending.reject(new Error(msg.error.message || "Codex 请求失败"))
          : pending.resolve(msg.result);
        return;
      }
      for (const listener of this.listeners) listener(msg);
    });
    await this.rpc("initialize", {
      clientInfo: { name: "zhereader", title: "ZheReader", version: "1.1.0" },
    });
    this.send({ method: "initialized" });
  }
  send(message) {
    if (this.proc?.stdin.writable)
      this.proc.stdin.write(JSON.stringify(message) + "\n");
  }
  rpc(method, params = {}, timeout = 25000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("本地连接响应超时，请检查 Codex 登录和网络。"));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  failAll(error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    for (const listener of this.listeners)
      listener({ method: "bridge/error", params: { message: error.message } });
  }
  async account() {
    await this.ensureStarted();
    const { account } = await this.rpc("account/read", { refreshToken: false });
    if (!account) return { connected: true, loggedIn: false };
    if (account.type !== "chatgpt")
      return {
        connected: true,
        loggedIn: false,
        error: "本功能只允许 ChatGPT 账号登录，不使用 API Key。",
      };
    return {
      connected: true,
      loggedIn: true,
      email: account.email || "",
      plan: account.planType || "",
    };
  }
  async login() {
    await this.ensureStarted();
    const r = await this.rpc("account/login/start", { type: "chatgpt" });
    const u = new URL(r.authUrl);
    if (
      u.protocol !== "https:" ||
      !["auth.openai.com", "chatgpt.com", "auth0.openai.com"].includes(
        u.hostname,
      )
    )
      throw new Error("登录地址不受支持，请更新 Codex CLI。");
    return { authUrl: r.authUrl, loginId: r.loginId };
  }
  async logout() {
    if (this.busy)
      throw Object.assign(
        new Error("请先停止正在进行的学习请求，再退出账号。"),
        { status: 409 },
      );
    await this.ensureStarted();
    await this.rpc("account/logout");
    return { ok: true };
  }
  async models() {
    await this.ensureStarted();
    const models = new Map();
    const seen = new Set();
    let cursor;
    do {
      const r = await this.rpc("model/list", {
        limit: 100,
        includeHidden: true,
        ...(cursor ? { cursor } : {}),
      });
      for (const model of r.data) models.set(model.model, model);
      cursor = r.nextCursor;
      if (cursor && seen.has(cursor))
        throw new Error("模型列表分页异常，请重试。");
      seen.add(cursor);
    } while (cursor);
    return [...models.values()];
  }
  async rateLimits() {
    await this.ensureStarted();
    return this.rpc("account/rateLimits/read");
  }
  async study(input, signal) {
    if (this.activeStudies >= 4)
      throw Object.assign(new Error("已有 4 个学习任务在运行，请稍后重试。"), {
        status: 409,
      });
    this.activeStudies++;
    this.busy = true;
    let threadId, turnId, listener, timer, onAbort;
    try {
      if (!(await this.account()).loggedIn)
        throw Object.assign(new Error("请先登录 ChatGPT 账号。"), {
          status: 401,
        });
      if (signal?.aborted) throw new Error("请求已取消");
      const models = await this.models();
      if (
        input.model &&
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(input.model)
      )
        throw Object.assign(new Error("模型 ID 格式无效。"), { status: 400 });
      const model = input.model
        ? models.find((m) => m.model === input.model) || { model: input.model }
        : models.find((m) => m.isDefault) ||
          models.find((m) => !m.hidden) ||
          models[0];
      if (!model)
        throw new Error("当前账号没有可用模型，请检查订阅或工作空间权限。");
      const r = await this.rpc("thread/start", {
        model: model.model,
        modelProvider: "openai",
        cwd: this.workspace,
        ephemeral: true,
        sandbox: "read-only",
        approvalPolicy: "never",
        baseInstructions: tutorInstructions,
        config: {
          web_search: input.action === "research" ? "live" : "disabled",
          "features.shell_tool": false,
          "features.unified_exec": false,
        },
      });
      threadId = r.thread.id;
      if (signal?.aborted) throw new Error("请求已取消");
      let finalText = "",
        searched = false;
      const completed = new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("处理超时，请缩短选区后重试。")),
          180000,
        );
        listener = (msg) => {
          if (msg.method === "bridge/error") {
            reject(new Error(msg.params.message));
            return;
          }
          if (msg.params?.threadId !== threadId) return;
          const item = msg.params.item;
          if (item?.type === "webSearch") searched = true;
          if (
            msg.method === "item/completed" &&
            item?.type === "agentMessage" &&
            item.phase !== "commentary"
          )
            finalText = item.text;
          if (msg.method === "turn/completed") {
            const turn = msg.params.turn;
            if (turn.status === "completed") resolve();
            else
              reject(
                new Error(
                  turn.error?.message ||
                    (turn.status === "interrupted"
                      ? "请求已取消"
                      : "模型处理失败，请检查账号剩余额度。"),
                ),
              );
          }
        };
        this.listeners.add(listener);
        onAbort = () => reject(new Error("请求已取消"));
        signal?.addEventListener("abort", onAbort, { once: true });
      });
      // Register before starting the turn; fast responses may arrive immediately.
      completed.catch(() => {});
      const supported =
        model.supportedReasoningEfforts?.map((e) => e.reasoningEffort) || [];
      const effort = supported.includes("low")
        ? "low"
        : model.defaultReasoningEffort;
      const started = await this.rpc("turn/start", {
        threadId,
        input: [
          {
            type: "text",
            text: input.action.startsWith("paper-")
              ? guidePrompt(input)
              : buildPrompt(input),
          },
        ],
        outputSchema: input.action.startsWith("paper-")
          ? guideSchema
          : resultSchema,
        ...(effort ? { effort } : {}),
      });
      turnId = started.turn.id;
      if (signal?.aborted) throw new Error("请求已取消");
      await completed;
      const result = input.action.startsWith("paper-")
        ? validateGuide(JSON.parse(finalText), input.text)
        : validateResult(JSON.parse(finalText));
      return { ...result, model: model.model, searched };
    } finally {
      clearTimeout(timer);
      this.listeners.delete(listener);
      signal?.removeEventListener("abort", onAbort);
      if (threadId && turnId)
        await this.rpc("turn/interrupt", { threadId, turnId }, 3000).catch(
          () => {},
        );
      if (threadId)
        await this.rpc("thread/unsubscribe", { threadId }, 3000).catch(
          () => {},
        );
      this.activeStudies--;
      this.busy = this.activeStudies > 0;
    }
  }
  close() {
    this.proc?.kill();
    this.lines?.close();
    this.starting = null;
  }
}
