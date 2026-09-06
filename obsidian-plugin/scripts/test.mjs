import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
await mkdir('test-results', { recursive: true });
await build({
  entryPoints: ['tests/order.test.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'test-results/order.test.mjs',
});
const result = spawnSync(
  process.execPath,
  ['--test', 'test-results/order.test.mjs'],
  { stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
