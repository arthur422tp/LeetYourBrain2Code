import { defineConfig } from "vite";
import { resolve } from "node:path";

const projectRoot = resolve(__dirname);

export default defineConfig({
  root: resolve(projectRoot, "src"),
  publicDir: resolve(projectRoot, "public"),
  build: {
    outDir: resolve(projectRoot, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(projectRoot, "src/sidepanel/index.html")
    }
  },
  test: {
    root: projectRoot,
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts"]
  }
});
