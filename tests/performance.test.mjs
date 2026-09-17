import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { sortItems, deleteOrders } from "../src/order.ts";

for (const size of [1000, 10000, 30000]) {
  test(`${size} items: ordering and bulk deletion`, async (t) => {
    const names = Array.from({ length: size }, (_, i) => `Note-${i}.md`);
    const manual = [...names].reverse();
    const start = performance.now();
    const sorted = sortItems(names, manual, (name) => name);
    const sortMs = performance.now() - start;
    assert.deepEqual(sorted, manual);
    const order = { A: manual, Offline: ["not-loaded.md"] };
    const deleted = names.filter((_, i) => i % 10 === 0).map((name) => `A/${name}`);
    const deleteStart = performance.now();
    const remaining = deleteOrders(order, deleted);
    const deleteMs = performance.now() - deleteStart;
    assert.deepEqual(
      remaining.A,
      manual.filter((name) => Number(name.slice(5, -3)) % 10 !== 0),
    );
    assert.deepEqual(remaining.Offline, ["not-loaded.md"]);
    t.diagnostic(JSON.stringify({ size, sortMs, bulkDeleteMs: deleteMs }));
  });
}
