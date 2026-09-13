import { StudyBridge } from "./study-bridge";
export function createCloudPanel({ icon, refreshIcons, importFiles, notify }) {
  const bridge = new StudyBridge();
  const $ = (id) => document.getElementById(id);
  const dialog = document.createElement("dialog");
  dialog.id = "cloud-dialog";
  dialog.innerHTML = `<div class="dialog-title"><div><span class="eyebrow">YOUR RESEARCH, WITHIN REACH</span><h2>${icon("cloud")} 坚果云论文</h2></div><button id="cloud-close" class="icon-button" aria-label="关闭坚果云">${icon("x")}</button></div><p>获取 Zotero 已同步的 PDF 附件，保存到这台浏览器，继续翻译与听读。</p><div class="cloud-connection"><button id="cloud-pair" class="secondary">连接本机服务</button><span>与 GPT 共用本地服务，无需登录 GPT。</span></div><details id="cloud-settings" open><summary>坚果云 WebDAV 设置</summary><form id="cloud-connect-form"><label>坚果云账号<input id="cloud-username" type="email" required autocomplete="username" placeholder="坚果云注册邮箱"></label><label>应用密码<input id="cloud-password" type="password" required autocomplete="off" placeholder="坚果云生成的第三方应用密码"></label><label class="cloud-wide">Zotero 附件目录<input id="cloud-directory" type="url" required value="https://dav.jianguoyun.com/dav/zotero/"></label><div class="cloud-wide cloud-form-actions"><button id="cloud-connect" class="primary" type="submit">连接并获取论文</button><button id="cloud-disconnect" class="text-button" type="button" hidden>断开坚果云</button><a href="https://help.jianguoyun.com/?p=2064" target="_blank" rel="noopener noreferrer">获取应用密码 ${icon("arrow-up-right")}</a></div></form><p class="cloud-hint">应用密码只在本机服务内存中使用，不写入浏览器存储或项目文件；本地服务重启后需重新填写。只读取附件，进度、书签与批注不回写 Zotero。</p></details><div class="cloud-toolbar"><button id="cloud-up" class="secondary" disabled>上一级</button><button id="cloud-refresh" class="secondary" disabled>刷新论文</button><input id="cloud-search" type="search" aria-label="搜索云端附件" placeholder="搜索文件名或 Zotero 附件编号"></div><p id="cloud-path" class="cloud-hint"></p><p id="cloud-status" role="status">连接后即可浏览附件。</p><p id="cloud-warning" class="cloud-hint" hidden></p><div id="cloud-files" class="cloud-files"></div><div class="cloud-footer"><label><input id="cloud-select-all" type="checkbox"> 全选当前显示的附件</label><div><button id="cloud-stop" class="text-button" hidden>停止</button><button id="cloud-import" class="primary" disabled>导入所选论文</button></div></div><details class="cloud-lookup"><summary>按 Zotero 附件编号获取</summary><p class="cloud-hint">若目录条目过多而未显示，可从 Zotero「显示文件」找到 8 位附件文件夹编号，直接读取对应附件包。</p><div><input id="cloud-key" maxlength="8" placeholder="例如 ABCD1234" aria-label="Zotero 附件编号"><button id="cloud-lookup" class="secondary">查看附件包</button></div></details><p class="cloud-hint">Zotero 的 ZIP 名称通常是附件编号；点击「查看 PDF」后可看到文件名。完整文献题名、分类与笔记不在 WebDAV 附件目录中。</p>`;
  document.body.append(dialog);
  let connected = false,
    root = "",
    directory = "",
    rows = [],
    busy = false,
    abort;
  const selected = new Set();
  function status(message) {
    $("cloud-status").textContent = message;
  }
  function lock(value) {
    busy = value;
    for (const id of [
      "cloud-connect",
      "cloud-disconnect",
      "cloud-pair",
      "cloud-refresh",
      "cloud-up",
      "cloud-lookup",
    ])
      $(id).disabled =
        value ||
        (["cloud-refresh", "cloud-up", "cloud-lookup"].includes(id) &&
          !connected);
    $("cloud-up").disabled = value || !connected || directory === root;
    $("cloud-stop").hidden = !value;
    $("cloud-import").disabled = value || !selected.size;
    render();
  }
  function visible() {
    const query = $("cloud-search").value.trim().toLowerCase();
    return rows.filter((r) =>
      `${r.name} ${r.path}`.toLowerCase().includes(query),
    );
  }
  function id(row) {
    return JSON.stringify([row.path, row.entry || ""]);
  }
  function render() {
    $("cloud-files").replaceChildren();
    const displayed = visible();
    for (const row of displayed) {
      const line = document.createElement("div");
      line.className = "cloud-file";
      if (row.kind !== "folder") {
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = selected.has(id(row));
        check.disabled = busy;
        check.setAttribute("aria-label", `选择 ${row.name}`);
        check.onchange = () => {
          check.checked ? selected.add(id(row)) : selected.delete(id(row));
          render();
        };
        line.append(check);
      }
      const text = document.createElement("div");
      text.className = "cloud-file-name";
      const title = document.createElement("strong");
      title.textContent = row.name;
      const meta = document.createElement("small");
      meta.textContent =
        row.kind === "folder"
          ? "文件夹"
          : row.kind === "archive"
            ? "Zotero 附件包 · 可查看 PDF 文件名"
            : `${(row.size / 1024 / 1024).toFixed(1)} MB${row.modified ? " · " + row.modified : ""}`;
      text.append(title, meta);
      line.append(text);
      if (row.kind === "folder" || row.kind === "archive") {
        const button = document.createElement("button");
        button.className = "text-button";
        button.disabled = busy;
        button.textContent = row.kind === "folder" ? "打开" : "查看 PDF";
        button.onclick = () =>
          row.kind === "folder" ? list(row.path) : expand(row);
        line.append(button);
      }
      $("cloud-files").append(line);
    }
    if (!displayed.length) {
      const p = document.createElement("p");
      p.className = "cloud-empty";
      p.textContent = connected
        ? "当前目录没有匹配的 PDF 或 Zotero 附件包。"
        : "先连接坚果云，论文会显示在这里。";
      $("cloud-files").append(p);
    }
    const selectable = displayed.filter((r) => r.kind !== "folder");
    $("cloud-select-all").checked =
      !!selectable.length && selectable.every((r) => selected.has(id(r)));
    $("cloud-select-all").disabled = busy || !selectable.length;
    $("cloud-import").disabled = busy || !selected.size;
    $("cloud-import").textContent = selected.size
      ? `导入所选论文（${selected.size}）`
      : "导入所选论文";
  }
  async function run(task) {
    if (busy) return;
    abort = new AbortController();
    lock(true);
    try {
      await task(abort.signal);
    } catch (error) {
      status(
        abort.signal.aborted
          ? "已停止；已导入的论文仍在书架中。"
          : error.message,
      );
    } finally {
      lock(false);
    }
  }
  function acceptListing(result) {
    directory = result.directory;
    rows = result.entries;
    selected.clear();
    $("cloud-path").textContent = decodeURIComponent(directory);
    $("cloud-warning").hidden = !result.possiblyTruncated;
    $("cloud-warning").textContent =
      "坚果云本次目录可能被截断（单次请求约 750 条目）。未显示的附件可按编号获取；当前列表不代表完整文库。";
    render();
  }
  async function list(path = directory) {
    return run(async (signal) => {
      status("正在获取云端附件…");
      const result = await bridge.request("cloud/list", {
        body: { path },
        signal,
      });
      acceptListing(result);
      status(`已刷新，显示 ${rows.length} 个文件或文件夹。`);
    });
  }
  async function expand(row) {
    return run(async (signal) => {
      status(`正在读取 ${row.name} 中的附件…`);
      const result = await bridge.request("cloud/contents", {
        body: { path: row.path },
        signal,
      });
      const files = result.entries.map((e) => ({ ...row, ...e, kind: "file" }));
      selected.delete(id(row));
      rows = rows.filter((r) => r.path !== row.path);
      rows.push(...files);
      render();
      status(
        files.length
          ? `找到 ${files.length} 个 PDF / EPUB。`
          : "此附件包没有 PDF 或 EPUB，可能是网页快照。",
      );
    });
  }
  $("cloud-open").onclick = async () => {
    dialog.showModal();
    if (busy) return;
    try {
      const state = await bridge.request("cloud/status");
      connected = state.connected;
      if (connected) {
        root = new URL(state.directory, "https://dav.jianguoyun.com").pathname;
        directory ||= root;
        $("cloud-username").value = state.username;
        $("cloud-directory").value = new URL(
          state.directory,
          "https://dav.jianguoyun.com",
        ).href;
        $("cloud-settings").open = false;
        $("cloud-disconnect").hidden = false;
        await list(directory);
      } else {
        $("cloud-settings").open = true;
        status("请填写坚果云账号与应用密码。");
      }
    } catch (error) {
      status(error.message);
    }
    lock(false);
  };
  $("cloud-close").onclick = () => {
    abort?.abort();
    $("cloud-password").value = "";
    dialog.close();
  };
  dialog.addEventListener("cancel", () => {
    abort?.abort();
    $("cloud-password").value = "";
  });
  $("cloud-pair").onclick = () =>
    run(async () => {
      await bridge.connect();
      status("本机服务已连接，可以填写坚果云设置。");
    });
  $("cloud-connect-form").onsubmit = (e) => {
    e.preventDefault();
    run(async (signal) => {
      try {
        status("正在验证坚果云并获取附件…");
        const result = await bridge.request("cloud/connect", {
          body: {
            username: $("cloud-username").value.trim(),
            password: $("cloud-password").value,
            directory: $("cloud-directory").value.trim(),
          },
          signal,
        });
        connected = true;
        root = result.directory;
        $("cloud-settings").open = false;
        $("cloud-disconnect").hidden = false;
        acceptListing(result);
        status(`连接成功，找到 ${rows.length} 个文件或附件包。`);
      } finally {
        $("cloud-password").value = "";
      }
    });
  };
  $("cloud-disconnect").onclick = () =>
    run(async () => {
      await bridge.request("cloud/disconnect", { body: {} });
      connected = false;
      root = directory = "";
      rows = [];
      selected.clear();
      $("cloud-disconnect").hidden = true;
      $("cloud-settings").open = true;
      status("已断开连接并清除内存中的应用密码。");
    });
  $("cloud-refresh").onclick = () => list();
  $("cloud-up").onclick = () => list(directory.replace(/[^/]+\/$/, ""));
  $("cloud-search").oninput = render;
  $("cloud-select-all").onchange = (e) => {
    for (const row of visible().filter((r) => r.kind !== "folder"))
      e.target.checked ? selected.add(id(row)) : selected.delete(id(row));
    render();
  };
  $("cloud-stop").onclick = () => abort?.abort();
  $("cloud-lookup").onclick = () => {
    const key = $("cloud-key").value.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(key)) {
      status("请输入 8 位 Zotero 附件编号。");
      return;
    }
    expand({ path: root + key + ".zip", name: key + ".zip", kind: "archive" });
  };
  $("cloud-import").onclick = () =>
    run(async (signal) => {
      const chosen = rows.filter((r) => selected.has(id(r)));
      let success = 0,
        failed = 0,
        processed = 0;
      const errors = [];
      for (const row of chosen) {
        signal.throwIfAborted();
        status(`正在获取 ${++processed}/${chosen.length}：${row.name}`);
        try {
          const entries =
            row.kind === "archive"
              ? (
                  await bridge.request("cloud/contents", {
                    body: { path: row.path },
                    signal,
                  })
                ).entries
              : [row];
          if (!entries.length) throw new Error("没有 PDF / EPUB");
          for (const entry of entries) {
            signal.throwIfAborted();
            const { blob, name } = await bridge.request("cloud/file", {
              body: { path: row.path, entry: entry.entry },
              signal,
              binary: true,
            });
            signal.throwIfAborted();
            const file = new File([blob], name);
            file.cloudSource = {
              provider: "nutstore",
              path: row.path,
              entry: entry.entry || "",
              etag: row.etag || "",
            };
            const result = await importFiles([file]);
            success += result?.success || 0;
            if (result?.failures?.length) {
              failed++;
              errors.push(...result.failures);
            }
          }
          selected.delete(id(row));
        } catch (error) {
          if (signal.aborted) throw error;
          failed++;
          errors.push(`${row.name}：${error.message}`);
        }
      }
      status(
        `完成：导入 ${success} 篇${failed ? `，${failed} 项未导入` : ""}。${errors.slice(0, 3).join("；")}`,
      );
      if (success)
        notify(`已从坚果云导入 ${success} 篇论文，返回书架即可阅读。`);
    });
  render();
  refreshIcons();
}
