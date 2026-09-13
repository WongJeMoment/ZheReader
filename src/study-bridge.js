const localBase = "http://127.0.0.1:4318";
export class StudyBridge {
  constructor() {
    this.base = localBase;
    this.token = "";
    this.accountInfo = null;
    const injected = window.__ZHEREADER_BRIDGE__;
    if (
      injected &&
      ["127.0.0.1", "localhost"].includes(location.hostname) &&
      injected.base === location.origin
    ) {
      this.local = true;
      this.base = injected.base;
      this.token = injected.token;
    } else {
      try {
        this.token = sessionStorage.getItem("zr-bridge-token") || "";
      } catch {}
    }
  }
  async request(
    path,
    { signal, body, binary = false, method = body ? "POST" : "GET" } = {},
  ) {
    if (!this.local) {
      try {
        this.token = sessionStorage.getItem("zr-bridge-token") || this.token;
      } catch {}
    }
    if (!this.token) throw new Error("请先连接本机服务。");
    for (let attempt = 0; attempt < 7; attempt++) {
      let response;
      try {
        response = await fetch(`${this.base}/api/${path}`, {
          method,
          signal,
          headers: {
            Authorization: `Bearer ${this.token}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch (error) {
        if (error.name === "AbortError") throw error;
        throw new Error(
          "无法连接本机服务。请启动 npm run start，并允许浏览器访问本地网络。",
        );
      }
      if (response.ok && binary)
        return {
          blob: await response.blob(),
          name: decodeURIComponent(
            response.headers.get("X-File-Name") || "paper.pdf",
          ),
        };
      const result = await response.json();
      if (response.status === 409 && path === "study" && attempt < 6) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        signal?.throwIfAborted();
        continue;
      }
      if (!response.ok) {
        if (result.code === "PAIR_REQUIRED") {
          this.token = "";
          try {
            sessionStorage.removeItem("zr-bridge-token");
          } catch {}
        }
        throw new Error(result.error || "请求失败，请重试。");
      }
      return result;
    }
  }
  connect() {
    const popup = window.open(
      `${this.base}/bridge/connect?origin=${encodeURIComponent(location.origin)}`,
      "zhereader-connect",
      "width=580,height=640",
    );
    if (!popup)
      return Promise.reject(new Error("请允许弹出窗口，再连接本机服务。"));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(closed);
        window.removeEventListener("message", receive);
      };
      const receive = (event) => {
        if (
          event.origin !== this.base ||
          event.source !== popup ||
          event.data?.type !== "zhereader:paired" ||
          !/^[a-f0-9]{64}$/.test(event.data.token || "")
        )
          return;
        this.token = event.data.token;
        try {
          sessionStorage.setItem("zr-bridge-token", this.token);
        } catch {}
        cleanup();
        resolve();
      };
      window.addEventListener("message", receive);
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("连接超时，请启动本机服务后重试。"));
      }, 90000);
      const closed = setInterval(() => {
        if (popup.closed) {
          cleanup();
          reject(new Error("连接窗口已关闭。"));
        }
      }, 600);
    });
  }
  async account() {
    this.accountInfo = await this.request("account");
    return this.accountInfo;
  }
  async study(input, signal) {
    return this.request("study", { body: input, signal });
  }
}
