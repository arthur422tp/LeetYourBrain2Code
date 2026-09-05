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
      input: resolve(projectRoot, "src/page-bridge/entry.ts"),
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "page-bridge/leetcode-main-world.js"
      }
    }
  }
});
