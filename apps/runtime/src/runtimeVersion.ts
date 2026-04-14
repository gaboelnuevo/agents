import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");

/** Semantic version from this package’s `package.json` (OpenAPI, health checks, logs). */
export const runtimePackageVersion: string = JSON.parse(readFileSync(pkgPath, "utf8")).version;
