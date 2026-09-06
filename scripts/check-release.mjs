import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const manifest = read("manifest.json");
assert.equal(manifest.version, read("package.json").version);
assert.equal(manifest.version, read("package-lock.json").version);
assert.equal(read("versions.json")[manifest.version], manifest.minAppVersion);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
if (process.env.GITHUB_REF_TYPE === "tag") {
  assert.equal(
    process.env.GITHUB_REF_NAME,
    manifest.version,
    "Release tag must match manifest.version, without a v prefix",
  );
}
console.log(`Release metadata verified: ${manifest.id} ${manifest.version}`);
