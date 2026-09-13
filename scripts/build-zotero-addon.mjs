import JSZip from "jszip";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const zip = new JSZip();
for (const file of ["manifest.json", "bootstrap.js", "bridge.js"])
  zip.file(
    file,
    await readFile(new URL("../zotero-addon/" + file, import.meta.url)),
    { date: new Date("2026-09-13T00:00:00Z") },
  );
zip.file(
  "annotations.js",
  (
    await readFile(new URL("../shared/annotations.js", import.meta.url), "utf8")
  ).replace(/^export /gm, ""),
  { date: new Date("2026-09-13T00:00:00Z") },
);
const out = new URL("../public/downloads/", import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(
  new URL("zhereader-zotero.xpi", out),
  await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
);
console.log("Built public/downloads/zhereader-zotero.xpi");
