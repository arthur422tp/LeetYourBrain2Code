import { defineConfig } from "vite";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(__dirname);
const bundledPyodideFiles = [
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "pyodide-lock.json",
  "pyodide.mjs",
  "python_stdlib.zip"
];

function copyBundledPyodide() {
  return {
    name: "copy-bundled-pyodide",
    apply: "build" as const,
    closeBundle() {
      const source = resolve(projectRoot, "node_modules/pyodide");
      const destination = resolve(projectRoot, "dist/pyodide");
      if (!existsSync(source)) {
        throw new Error("The bundled Pyodide package is missing");
      }
      rmSync(destination, { recursive: true, force: true });
      mkdirSync(destination, { recursive: true });
      for (const file of bundledPyodideFiles) {
        const sourceFile = resolve(source, file);
        if (!existsSync(sourceFile)) {
          throw new Error(`The bundled Pyodide runtime file is missing: ${file}`);
        }
        cpSync(sourceFile, resolve(destination, file));
      }
    }
  };
}

export default defineConfig({
  plugins: [copyBundledPyodide()],
  root: resolve(projectRoot, "src"),
  publicDir: resolve(projectRoot, "public"),
  build: {
    outDir: resolve(projectRoot, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "sidepanel/index": resolve(projectRoot, "src/sidepanel/index.html"),
        "worker/pyodide-worker": resolve(projectRoot, "src/worker/pyodide-worker.ts")
      },
      output: {
        entryFileNames: "[name].js"
      }
    }
  },
  test: {
    root: projectRoot,
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts"]
  }
});
