import * as esbuild from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url));
await mkdir(path.join(root, "dist"), { recursive: true });
for (const name of ["manifest.json", "styles.css"])
  await copyFile(path.join(root, name), path.join(root, "dist", name));
const config = {
  absWorkingDir: root,
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  platform: "browser",
  target: "es2022",
  outfile: "main.js",
  sourcemap: process.argv.includes("--watch") ? "inline" : false,
  logLevel: "info",
};
if (process.argv.includes("--watch")) {
  const context = await esbuild.context(config);
  await context.watch();
} else {
  await esbuild.build(config);
  await copyFile(path.join(root, "main.js"), path.join(root, "dist/main.js"));
}
