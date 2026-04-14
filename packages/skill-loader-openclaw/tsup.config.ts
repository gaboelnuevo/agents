import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "cli/install-skill": "src/cli/install-skill.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  platform: "node",
  target: "node18",
  async onSuccess() {
    const cliJs = path.join(dir, "dist/cli/install-skill.js");
    let body = await readFile(cliJs, "utf8");
    if (!body.startsWith("#!/usr/bin/env node")) {
      body = "#!/usr/bin/env node\n" + body;
      await writeFile(cliJs, body);
    }
  },
});
