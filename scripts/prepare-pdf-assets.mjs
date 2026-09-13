import { cpSync, mkdirSync } from "node:fs";
mkdirSync("public/pdf-assets", { recursive: true });
for (const folder of ["cmaps", "standard_fonts", "wasm"]) {
  cpSync(`node_modules/pdfjs-dist/${folder}`, `public/pdf-assets/${folder}`, {
    recursive: true,
  });
}
