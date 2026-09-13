import { openDB } from "idb";
const database = openDB("zhereader", 1, {
  upgrade(db) {
    db.createObjectStore("books", { keyPath: "id" });
    db.createObjectStore("files");
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
  const tx = (await database).transaction(["books", "files"], "readwrite");
  await tx.objectStore("books").delete(id);
  await tx.objectStore("files").delete(id);
  await tx.done;
}
