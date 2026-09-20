import { defineConfig } from "vite";
import { resolve } from "node:path";

const projectRoot = resolve(__dirname);

export default defineConfig({
  root: projectRoot,
  publicDir: false,
  build: {
    outDir: resolve(projectRoot, "dist"),
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(projectRoot, "src/background/service-worker.ts"),
      output: {
        format: "es",
        inlineDynamicImports: true,
        entryFileNames: "background/service-worker.js"
      }
    }
  }
});
