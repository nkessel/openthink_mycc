import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the built site works on GitHub Pages (served from /<repo>/)
  base: "./",
  server: {
    port: 5173,
    strictPort: false,
  },
});
