import { defineConfig, type Plugin } from "vite";
import { execSync } from "node:child_process";

/** Each build writes dist/version.json: the release tag (e.g. v1.2.0, or the commit when there is no tag yet),
 *  the commit and when it was built, so anyone can tell which version is live (<site>/version.json). */
function versionFile(): Plugin {
  const git = (cmd: string) => {
    try {
      return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "";
    }
  };
  return {
    name: "version-json",
    apply: "build",
    generateBundle() {
      const commit = process.env.GITHUB_SHA || git("rev-parse HEAD");
      const tag = (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME) || git("describe --tags --always");
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: tag || commit.slice(0, 7) || "dev", commit, built_at: new Date().toISOString() }, null, 2) + "\n",
      });
    },
  };
}

export default defineConfig({
  // Relative base so the built site works on GitHub Pages (served from /<repo>/)
  base: "./",
  plugins: [versionFile()],
  server: {
    port: 5173,
    strictPort: false,
  },
});
