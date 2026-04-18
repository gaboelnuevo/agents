import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  resolve: {
    alias: {
      /** Tests import `@opencoreagents/rest-api` from `dist` via package.json `exports`; alias keeps them on TS source without a manual build. */
      "@opencoreagents/rest-api": path.join(repoRoot, "packages/rest-api/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
