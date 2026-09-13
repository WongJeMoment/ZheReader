import { openDB } from "idb";
const database = openDB("zhereader", 2, {
  blocked() {
    window.dispatchEvent(new CustomEvent("zr-storage-blocked"));
  },
  blocking() {
    database.then((db) => db.close());
    window.dispatchEvent(new CustomEvent("zr-storage-blocked"));
  },
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore("books", { keyPath: "id" });
      db.createObjectStore("files");
    }
    if (oldVersion < 2) {
      const annotations = db.createObjectStore("annotations", {
        keyPath: "id",
      });
      annotations.createIndex("bookId", "bookId");
      db.createObjectStore("settings");
    }
  },
});
export async function listBooks() {
  return (await database).getAll("books");
}
export async function getFile(id) {
  return (await database).get("files", id);
}
export async function putBook(book, data) {
  const db = await database;
  const tx = db.transaction(data ? ["books", "files"] : ["books"], "readwrite");
  await tx.objectStore("books").put(book);
  if (data) await tx.objectStore("files").put(data, book.id);
  await tx.done;
}
export async function removeBook(id) {
  const tx = (await database).transaction(
    ["books", "files", "annotations"],
    "readwrite",
  );
  await tx.objectStore("books").delete(id);
  await tx.objectStore("files").delete(id);
  for (const key of await tx
    .objectStore("annotations")
    .index("bookId")
    .getAllKeys(id))
    await tx.objectStore("annotations").delete(key);
  await tx.done;
}

export async function listAnnotations(bookId) {
  return (await database).getAllFromIndex("annotations", "bookId", bookId);
}
export async function putAnnotation(record) {
  return (await database).put("annotations", record);
}
export async function removeAnnotation(id) {
  return (await database).delete("annotations", id);
}
export async function getSetting(key) {
  return (await database).get("settings", key);
}
export async function putSetting(key, value) {
  return (await database).put("settings", value, key);
}
