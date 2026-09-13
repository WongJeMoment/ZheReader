import { defineConfig } from "vite";
import { cpSync } from "node:fs";
export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "pdf-assets",
      closeBundle() {
        for (const folder of ["cmaps", "standard_fonts", "wasm"]) {
          cpSync(
            `node_modules/pdfjs-dist/${folder}`,
            `dist/pdf-assets/${folder}`,
            { recursive: true },
          );
        }
      },
    },
  ],
  build: { chunkSizeWarningLimit: 1500 },
});
