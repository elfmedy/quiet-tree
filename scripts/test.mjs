import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
await mkdir("test-results", { recursive: true });
await build({
  entryPoints: [
    "tests/order.test.mjs",
    "tests/explorer.test.mjs",
    "tests/compatibility.test.mjs",
    "tests/performance.test.mjs",
  ],
  alias: { obsidian: "./tests/obsidian-stub.mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: "test-results",
  outExtension: { ".js": ".mjs" },
});
const result = spawnSync(
  process.execPath,
  [
    "--test",
    "test-results/order.test.mjs",
    "test-results/explorer.test.mjs",
    "test-results/compatibility.test.mjs",
    "test-results/performance.test.mjs",
  ],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
