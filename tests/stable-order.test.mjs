import test from "node:test";
import assert from "node:assert/strict";
import { OrderEditor, StableOrder } from "../src/stable-order.ts";
import { sortItems } from "../src/order.ts";

const plain = (order) => JSON.parse(JSON.stringify(order));
function harness(initial = {}, rules = []) {
  let saved = structuredClone(initial);
  const stable = new StableOrder();
  let pending = [];
  return {
    stable,
    observe(path, names, complete = true) {
      stable.observe(path, names, complete);
    },
    stage(change) {
      const event = stable.stage(change, saved, rules);
      pending.push(event);
      return event;
    },
    names(path) {
      return stable.names(path, saved[path]);
    },
    apply() {
      const editor = new OrderEditor(saved, rules);
      for (const event of pending) editor.apply(event);
      saved = editor.result();
      rules = editor.rules;
      stable.accept(saved, [], rules, pending);
      pending = [];
      return plain(saved);
    },
    begin() {
      const batch = pending;
      pending = [];
      stable.startBatch();
      return batch;
    },
    complete(batch) {
      const editor = new OrderEditor(saved, rules);
      for (const event of batch) editor.apply(event);
      saved = editor.result();
      stable.accept(saved, pending, rules, batch);
    },
    external(order) {
      saved = structuredClone(order);
      stable.rebase(saved, pending, rules);
    },
    get saved() {
      return plain(saved);
    },
  };
}

for (const initial of [{}, { A: ["F.md"] }, { A: ["F.md", "B.md", "D.md"] }]) {
  test(`rename keeps the entire prior display with ${initial.A?.length ?? 0} recorded items`, () => {
    const h = harness(initial);
    const before = sortItems(["B.md", "D.md", "F.md"], initial.A, (n) => n);
    h.observe("A", before);
    // The native listener can sort first, after the object name already changed.
    h.observe(
      "A",
      sortItems(["D.md", "F.md", "Z.md"], initial.A, (n) => n),
    );
    h.stage({ kind: "rename", from: "A/B.md", to: "A/Z.md" });
    assert.deepEqual(
      h.names("A"),
      before.map((n) => (n === "B.md" ? "Z.md" : n)),
    );
    assert.deepEqual(h.apply().A, h.names("A"));
  });
}

test("new files and folders append in event order and a later name change keeps the slot", () => {
  const h = harness();
  h.observe("/", ["B.md", "D.md"]);
  h.stage({ kind: "create", path: "Z.md" });
  h.stage({ kind: "create", path: "A.canvas" });
  h.stage({ kind: "rename", from: "A.canvas", to: "0.base" });
  h.stage({ kind: "create", path: "New folder" });
  assert.deepEqual(h.names("/"), ["B.md", "D.md", "Z.md", "0.base", "New folder"]);
  assert.deepEqual(h.apply()["/"], h.names("/"));
});

test("a new empty directory needs no native rows before creating its first notes", () => {
  const h = harness();
  h.stable.seedEmpty("New");
  h.stage({ kind: "create", path: "New/Z.md" });
  h.stage({ kind: "create", path: "New/A.md" });
  assert.deepEqual(h.apply().New, ["Z.md", "A.md"]);
});

test("delete then recreate the same name appends instead of resurrecting the old position", () => {
  const h = harness({ A: ["B.md", "D.md", "F.md"] });
  h.observe("A", ["B.md", "D.md", "F.md"]);
  h.stage({ kind: "delete", path: "A/B.md" });
  h.stage({ kind: "create", path: "A/B.md" });
  h.stage({ kind: "rename", from: "A/D.md", to: "A/Z.md" });
  assert.deepEqual(h.names("A"), ["Z.md", "F.md", "B.md"]);
  assert.deepEqual(h.apply().A, ["Z.md", "F.md", "B.md"]);
});

test("an edit following a deletion must not refill removed names from the old baseline", () => {
  const h = harness();
  h.observe("A", ["B.md", "D.md"]);
  h.stage({ kind: "create", path: "A/X.md" });
  h.stage({ kind: "delete", path: "A/B.md" });
  h.stage({ kind: "create", path: "A/Y.md" });
  assert.deepEqual(h.apply().A, ["D.md", "X.md", "Y.md"]);
});

test("deleting from an unrecorded folder before its first create cannot revive the deleted name", () => {
  const h = harness();
  h.observe("A", ["B.md", "D.md"]);
  h.stage({ kind: "delete", path: "A/B.md" });
  h.stage({ kind: "create", path: "A/C.md" });
  assert.deepEqual(h.names("A"), ["D.md", "C.md"]);
  assert.deepEqual(h.apply().A, ["D.md", "C.md"]);
});

test("native cross-folder move pins both parents and appends at destination", () => {
  const h = harness();
  h.observe("A", ["B.md", "D.md"]);
  h.observe("C", ["F.md", "G.md"]);
  h.stage({ kind: "rename", from: "A/B.md", to: "C/B.md" });
  assert.deepEqual(h.names("A"), ["D.md"]);
  assert.deepEqual(h.names("C"), ["F.md", "G.md", "B.md"]);
  assert.deepEqual(h.apply(), { A: ["D.md"], C: ["F.md", "G.md", "B.md"] });
});

test("moving out and back in one burst never duplicates a name or its old slot", () => {
  const h = harness({ A: ["B.md", "D.md"], C: [] });
  h.stage({ kind: "rename", from: "A/B.md", to: "C/B.md" });
  h.stage({ kind: "rename", from: "C/B.md", to: "A/B.md" });
  assert.deepEqual(h.apply(), { A: ["D.md", "B.md"], C: [] });
});

test("folder rename carries unopened baselines, nested records and exclusion paths", () => {
  const h = harness({ "A/Sub": ["D.md", "B.md"] }, ["A/assets"]);
  h.observe("/", ["A", "C"]);
  h.observe("A/Sub", ["D.md", "B.md"]);
  h.stage({ kind: "rename", from: "A", to: "Z" });
  h.stage({ kind: "create", path: "Z/Sub/A.md" });
  h.stage({ kind: "create", path: "Z/assets/x.png" });
  const result = h.apply();
  assert.deepEqual(result["/"], ["Z", "C"]);
  assert.deepEqual(result["Z/Sub"], ["D.md", "B.md", "A.md"]);
  assert.equal(result["Z/assets"], undefined);
  assert.equal(result["A/Sub"], undefined);
});

test("partial search results cannot replace the complete baseline", () => {
  const h = harness();
  h.observe("A", ["B.md", "D.md", "F.md"]);
  h.observe("A", ["D.md"], false);
  h.stage({ kind: "rename", from: "A/D.md", to: "A/Z.md" });
  assert.deepEqual(h.apply().A, ["B.md", "Z.md", "F.md"]);
});

test("an explicit native sort change updates an untouched baseline", () => {
  const h = harness();
  h.observe("A", ["B.md", "D.md"]);
  h.observe("A", ["D.md", "B.md"]);
  h.stage({ kind: "create", path: "A/C.md" });
  assert.deepEqual(h.apply().A, ["D.md", "B.md", "C.md"]);
});

test("reset forgets old manual ranks and next operation freezes the new native order", () => {
  const h = harness({ A: ["D.md", "B.md"] });
  h.observe("A", ["D.md", "B.md"]);
  h.external({});
  h.stable.forget("A");
  h.observe("A", ["B.md", "D.md"]);
  h.stage({ kind: "create", path: "A/C.md" });
  assert.deepEqual(h.apply().A, ["B.md", "D.md", "C.md"]);
});

test("synced ranks win over old baseline and an already-synced create is idempotent", () => {
  const h = harness();
  h.observe("A", ["B.md", "D.md"]);
  h.stage({ kind: "create", path: "A/Z.md" });
  h.external({ A: ["Z.md", "D.md", "B.md"], Other: ["remote.md"] });
  assert.deepEqual(h.names("A"), ["Z.md", "D.md", "B.md"]);
  assert.deepEqual(h.apply(), { A: ["Z.md", "D.md", "B.md"], Other: ["remote.md"] });
});

test("an already-synced rename does not add a ghost old name", () => {
  const h = harness();
  h.observe("A", ["B.md", "D.md"]);
  h.stage({ kind: "rename", from: "A/B.md", to: "A/Z.md" });
  h.external({ A: ["D.md", "Z.md"] });
  assert.deepEqual(h.apply().A, ["D.md", "Z.md"]);
});

test("events arriving during save retain chronological baselines without old renamed names", () => {
  const h = harness();
  h.observe("A", ["B.md", "D.md"]);
  h.stage({ kind: "rename", from: "A/B.md", to: "A/Z.md" });
  const batch = h.begin();
  h.stage({ kind: "rename", from: "A/Z.md", to: "A/C.md" });
  h.stage({ kind: "create", path: "A/A.md" });
  h.complete(batch);
  assert.deepEqual(h.names("A"), ["C.md", "D.md", "A.md"]);
  assert.deepEqual(h.apply().A, ["C.md", "D.md", "A.md"]);
});

test("a folder rename during save cannot leave the old directory's baseline behind", () => {
  const h = harness();
  h.observe("/", ["A"]);
  h.observe("A", ["B.md", "D.md"]);
  h.stage({ kind: "create", path: "A/X.md" });
  const batch = h.begin();
  h.stage({ kind: "rename", from: "A", to: "Z" });
  h.complete(batch);
  assert.equal(h.stable.has("A"), false);
  assert.deepEqual(h.apply().Z, ["B.md", "D.md", "X.md"]);
  h.stable.seedEmpty("A");
  h.stage({ kind: "create", path: "A/New.md" });
  assert.deepEqual(h.apply().A, ["New.md"]);
});

test("unrelated synced settings retain a partial directory's unrecorded baseline", () => {
  const h = harness({ A: ["F.md"] });
  h.observe("A", ["F.md", "B.md", "D.md"]);
  h.external({ A: ["F.md"] });
  h.stage({ kind: "rename", from: "A/B.md", to: "A/Z.md" });
  assert.deepEqual(h.apply().A, ["F.md", "Z.md", "D.md"]);
});

test("excluded directories are not pinned while their position in a parent is recorded", () => {
  const h = harness({}, ["assets"]);
  h.observe("/", ["assets", "Notes"]);
  h.stage({ kind: "create", path: "assets/new.png" });
  h.stage({ kind: "rename", from: "assets", to: "Images" });
  assert.deepEqual(h.apply(), { "/": ["Images", "Notes"] });
});

test("30,000 sequential creates use one baseline and leave the input snapshot unchanged", (t) => {
  const initial = { A: ["existing.md"], Offline: ["not-yet-synced.md"] };
  const editor = new OrderEditor(initial, []);
  const baseline = ["existing.md"];
  const start = performance.now();
  for (let i = 0; i < 30000; i++)
    editor.apply({ kind: "create", path: `A/${i}.md`, destination: baseline });
  const result = editor.result();
  assert.equal(result.A.length, 30001);
  assert.equal(result.A.at(-1), "29999.md");
  assert.deepEqual(initial, { A: ["existing.md"], Offline: ["not-yet-synced.md"] });
  t.diagnostic(`30,000 appends: ${(performance.now() - start).toFixed(1)} ms`);
});

test("a create arriving during an explicit drop cannot retain a ghost of the moved-out file", () => {
  const stable = new StableOrder();
  stable.observe("A", ["B.md", "D.md"], true);
  const pending = [stable.stage({ kind: "create", path: "A/C.md" }, {}, [])];
  const rebased = stable.afterMove("A/B.md", "Z/B.md", pending);
  const editor = new OrderEditor({ Z: ["B.md", "F.md"] }, []);
  for (const change of rebased) editor.apply(change);
  assert.deepEqual(editor.result().A, ["D.md", "C.md"]);
  assert.deepEqual(pending[0].destination, ["B.md", "D.md"]);
});

test("drop rollback relocates pending events inside a moved directory", () => {
  const stable = new StableOrder();
  const changes = stable.afterRollback("Z/Folder", "A/Folder", [
    { kind: "create", path: "Z/Folder/Sub/New.md", destination: ["B.md"] },
    { kind: "rename", from: "Z/Folder/Sub/B.md", to: "Z/Folder/Sub/C.md", source: ["B.md"] },
  ]);
  const editor = new OrderEditor({ "A/Folder/Sub": ["B.md"] }, []);
  for (const change of changes) editor.apply(change);
  assert.deepEqual(editor.result()["A/Folder/Sub"], ["C.md", "New.md"]);
  assert.equal(editor.result()["Z/Folder/Sub"], undefined);
});

test("mixed filesystem bursts match an independent list model across repeated commits", () => {
  for (let seed = 1; seed <= 25; seed++) {
    let random = seed;
    const next = (max) => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      return random % max;
    };
    const h = harness();
    const expected = { A: ["B.md", "D.md"], C: ["F.md", "G.md"] };
    for (const path of ["A", "C"]) h.observe(path, expected[path]);
    for (let i = 0; i < 150; i++) {
      const source = next(2) ? "A" : "C",
        destination = source === "A" ? "C" : "A";
      const action = next(4),
        fresh = `Note-${seed}-${i}.md`;
      if (!expected[source].length || action === 0) {
        expected[source].push(fresh);
        h.stage({ kind: "create", path: `${source}/${fresh}` });
      } else {
        const index = next(expected[source].length),
          old = expected[source][index];
        if (action === 1) {
          expected[source][index] = fresh;
          h.stage({ kind: "rename", from: `${source}/${old}`, to: `${source}/${fresh}` });
        } else if (action === 2) {
          expected[source].splice(index, 1);
          h.stage({ kind: "delete", path: `${source}/${old}` });
        } else {
          expected[source].splice(index, 1);
          expected[destination].push(old);
          h.stage({ kind: "rename", from: `${source}/${old}`, to: `${destination}/${old}` });
        }
      }
      for (const path of ["A", "C"]) {
        const native = [...expected[path]].sort();
        const actual = sortItems(native, h.names(path), (name) => name);
        assert.deepEqual(actual, expected[path], `seed ${seed}, event ${i}, folder ${path}`);
      }
      if (i % 7 === 0) {
        h.apply();
        for (const path of ["A", "C"]) h.observe(path, expected[path]);
      }
    }
    h.apply();
  }
});
