export function bookTags(book) {
  return [
    ...new Set(
      (book.zotero
        ? [...(book.zotero.collectionPaths || []), ...(book.zotero.tags || [])]
        : book.tags || []
      )
        .filter((tag) => typeof tag === "string" && tag.trim())
        .map((tag) => tag.trim()),
    ),
  ].sort((a, b) => a.localeCompare(b, "zh-CN"));
}
export function createTagFilter({ getBooks, renderBooks, saveBook, notify }) {
  let selected = null;
  const bar = document.getElementById("tag-filter");
  const dialog = document.createElement("dialog");
  dialog.id = "tags-dialog";
  dialog.innerHTML = `<form><div class="dialog-title"><h2>书籍标签</h2><button type="button" id="tags-close" class="icon-button" aria-label="关闭标签编辑">×</button></div><p id="tags-book-title"></p><label for="local-tags">本地标签（用逗号或换行分隔）</label><textarea id="local-tags" rows="4" maxlength="2000" placeholder="例如：待读，机器学习，精读"></textarea><p id="zotero-tags-info"></p><p>本地标签保存在当前浏览器；Zotero 标签请在 Zotero 中编辑后刷新。</p><button type="submit" class="primary">保存标签</button></form>`;
  document.body.append(dialog);
  let editing;
  dialog.querySelector("#tags-close").onclick = () => dialog.close();
  dialog.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const button = dialog.querySelector("[type=submit]");
    button.disabled = true;
    try {
      const tags = [
        ...new Set(
          dialog
            .querySelector("textarea")
            .value.split(/[,，\n]/)
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      ];
      if (tags.length > 50 || tags.some((t) => t.length > 100))
        throw new Error("最多 50 个标签，每个标签最多 100 字。");
      const book = getBooks().find((b) => b.id === editing);
      if (!book) throw new Error("这本书已被移除。");
      if (book.zotero)
        throw new Error("请在 Zotero 中修改分类和标签，然后刷新关联。");
      await saveBook({ ...book, tags });
      book.tags = tags;
      dialog.close();
      renderBooks();
    } catch (e) {
      notify(e.message);
    } finally {
      button.disabled = false;
    }
  };
  return {
    edit(id) {
      const book = getBooks().find((b) => b.id === id);
      if (!book || book.zotero) return;
      editing = id;
      dialog.querySelector("#tags-book-title").textContent = book.title;
      dialog.querySelector("textarea").value = (book.tags || []).join("，");
      dialog.querySelector("#zotero-tags-info").textContent =
        "Zotero 标签：" + (book.zotero?.tags?.join(" · ") || "暂无");
      dialog.showModal();
    },
    matches(book, query) {
      const tags = bookTags(book);
      return (
        (selected === null ||
          (selected === "" ? !tags.length : tags.includes(selected))) &&
        (!query.trim() ||
          tags.some((t) =>
            t.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
          ))
      );
    },
    render(query) {
      const counts = new Map();
      let untagged = 0;
      for (const book of getBooks()) {
        const tags = bookTags(book);
        if (!tags.length) untagged++;
        for (const tag of tags) counts.set(tag, (counts.get(tag) || 0) + 1);
      }
      if (selected && !counts.has(selected)) selected = null;
      bar.replaceChildren();
      const add = (value, name, count) => {
        const button = document.createElement("button");
        button.className = "tag-chip";
        button.setAttribute("aria-pressed", String(selected === value));
        button.textContent = `${name} · ${count}`;
        button.onclick = () => {
          selected = value;
          renderBooks();
        };
        bar.append(button);
      };
      add(null, "全部标签", getBooks().length);
      add("", "未添加标签", untagged);
      for (const [tag, count] of [...counts].sort(([a], [b]) =>
        a.localeCompare(b, "zh-CN"),
      ))
        if (
          tag === selected ||
          tag.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
        )
          add(tag, tag, count);
    },
  };
}
