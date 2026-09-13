import JSZip from "jszip";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const zip = new JSZip();
const manifest = JSON.parse(
  await readFile(
    new URL("../zotero-addon/manifest.json", import.meta.url),
    "utf8",
  ),
);
const app = manifest.applications.zotero;
for (const field of [
  "id",
  "update_url",
  "strict_min_version",
  "strict_max_version",
])
  if (!app[field])
    throw new Error(`Missing required Zotero manifest field: ${field}`);
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
const archive = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
});
await writeFile(new URL("zhereader-zotero.xpi", out), archive);
await writeFile(
  new URL("zotero-updates.json", out),
  JSON.stringify(
    {
      addons: {
        [app.id]: {
          updates: [
            {
              version: manifest.version,
              update_link: new URL("zhereader-zotero.xpi", app.update_url).href,
              update_hash:
                "sha256:" + createHash("sha256").update(archive).digest("hex"),
              applications: {
                zotero: {
                  strict_min_version: app.strict_min_version,
                  strict_max_version: app.strict_max_version,
                },
              },
            },
          ],
        },
      },
    },
    null,
    2,
  ) + "\n",
);
console.log("Built public/downloads/zhereader-zotero.xpi");
