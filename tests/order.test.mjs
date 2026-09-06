import test from "node:test";
import { destinationLabel } from "../src/presentation.ts";
import { translate } from "../src/i18n.ts";
import { createScenario } from "../lib/explorer-model.ts";
import assert from "node:assert/strict";
import { readSettings } from "../src/settings-data.ts";

test("editable settings accept known fields and reject malformed values", () => {
  assert.deepEqual(readSettings(null), {});
  assert.deepEqual(
    readSettings({ language: "invalid", trigger: 42, delay: Infinity, excluded: [42] }),
    {},
  );
  assert.deepEqual(
    readSettings({ language: "en", trigger: "handle", delay: 50, excluded: ["Assets", "Assets"] }),
    { language: "en", trigger: "handle", delay: 180, excluded: ["Assets"] },
  );
  assert.deepEqual(readSettings({ delay: 900, excluded: ["../outside"] }), { delay: 800 });
  assert.deepEqual(readSettings({ excluded: [] }), { excluded: [] });
});

test("destination copy separates the directory from the exact sibling position", () => {
  const { tree } = createScenario("boundary");
  const inner = { parentId: "a", beforeId: null, depth: 1, kind: "insert" };
  const outer = { parentId: null, beforeId: "d", depth: 0, kind: "insert" };
  assert.deepEqual(
    destinationLabel(tree, inner, "b", (key) => translate("zh", key)),
    { directory: "A", path: "a", position: "C 之后" },
  );
  assert.equal(
    destinationLabel(tree, outer, "b", (key) => translate("zh", key)).position,
    "A 与 D 之间",
  );
  assert.equal(
    destinationLabel(tree, outer, "b", (key) => translate("en", key)).position,
    "Between A and D",
  );
  assert.equal(
    destinationLabel(tree, { ...inner, beforeId: "c" }, "b", (key) => translate("zh", key))
      .position,
    "C 之前",
  );
});
import {
  parseOrder,
  stringifyOrder,
  sortItems,
  parseExclusions,
  attachmentExclusion,
  excluded,
  withoutExcluded,
  renameExclusions,
  renameOrder,
  deleteOrder,
  orderPath,
  OrderStore,
} from "../src/order.ts";

test("human-editable JSON roundtrip, root, Unicode and omitted native items", () => {
  const order = parseOrder('{"/": ["D", "中文.md"], "A": ["C.md", "B.md"]}');
  assert.deepEqual(JSON.parse(stringifyOrder(order)), {
    "/": ["D", "中文.md"],
    A: ["C.md", "B.md"],
  });
  assert.deepEqual(
    sortItems(["A", "D", "E", "中文.md"], order["/"], (x) => x),
    ["D", "中文.md", "A", "E"],
  );
});
test("reject malformed documents and duplicate or non-direct children", () => {
  for (const input of [
    "[]",
    "null",
    '{"A": "B"}',
    '{"A": ["B","B"]}',
    '{"A": ["a/b"]}',
    '{"../A": []}',
    '{"A": [".."]}',
    '{"A": [2]}',
    '{"A":[],}',
  ])
    assert.throws(() => parseOrder(input));
  assert.deepEqual(parseOrder('{"__proto__": ["constructor"]}').__proto__, ["constructor"]);
  assert.equal(Object.getPrototypeOf(parseOrder("{}")), null);
});
test("exclusions follow directory boundaries without removing the folder from its parent", () => {
  const rules = parseExclusions(" Assets/Images\n附件\n附件\n");
  assert.deepEqual(rules, ["Assets/Images", "附件"]);
  assert.equal(excluded("附件/2026", rules), true);
  assert.equal(excluded("附件笔记", rules), false);
  assert.deepEqual(
    JSON.parse(
      stringifyOrder(
        withoutExcluded(
          parseOrder(
            '{"/": ["附件", "A"], "附件": ["1.png"], "附件/2026": ["2.png"], "A": ["B.md"]}',
          ),
          rules,
        ),
      ),
    ),
    { "/": ["附件", "A"], A: ["B.md"] },
  );
});
test("attachment root/current-note modes never exclude the whole vault", () => {
  for (const setting of [undefined, "", "/", ".", "./assets"])
    assert.deepEqual(attachmentExclusion(setting), []);
  assert.deepEqual(attachmentExclusion("Assets/Images"), ["Assets/Images"]);
});
test("excluded folders follow moves without matching unrelated prefixes", () => {
  assert.deepEqual(renameExclusions(["A/Images", "AA/Images"], "A", "D/A"), [
    "D/A/Images",
    "AA/Images",
  ]);
});
test("sort path is portable and cannot overwrite application settings", () => {
  assert.equal(
    orderPath(".obsidian/plugins/quiet-tree/sort-order.json", ".obsidian", "quiet-tree"),
    ".obsidian/plugins/quiet-tree/sort-order.json",
  );
  assert.equal(orderPath("Meta/order.json", ".obsidian", "quiet-tree"), "Meta/order.json");
  for (const path of [
    "../order.json",
    "C:\\order.json",
    "/order.json",
    "a/../order.json",
    "order.md",
    ".obsidian/app.json",
    ".obsidian/plugins/quiet-tree/data.json",
    ".obsidian/plugins/other/order.json",
  ])
    assert.throws(() => orderPath(path, ".obsidian", "quiet-tree"));
});
test("renames preserve positions and rewrite recorded descendants only", () => {
  const original = parseOrder(
    '{"/": ["A", "D"], "A": ["B.md","C.md"], "A/Sub": ["中文.md"], "AA": ["Keep.md"]}',
  );
  const changed = renameOrder(original, "A", "Archive");
  assert.deepEqual(changed["/"], ["Archive", "D"]);
  assert.deepEqual(changed.Archive, ["B.md", "C.md"]);
  assert.deepEqual(changed["Archive/Sub"], ["中文.md"]);
  assert.deepEqual(changed.AA, ["Keep.md"]);
  assert.deepEqual(renameOrder(original, "A/B.md", "A/Z.md").A, ["Z.md", "C.md"]);
  assert.equal(renameOrder(original, "A/B.md", "New/B.md").New, undefined);
});
test("delete prunes recorded descendants and exact parent entry", () => {
  const result = deleteOrder(
    parseOrder('{"/": ["A", "AA"], "A": ["B.md"], "A/Sub": [], "AA": []}'),
    "A",
  );
  assert.deepEqual(Object.keys(result), ["/", "AA"]);
  assert.deepEqual(result["/"], ["AA"]);
});
function memory() {
  const files = new Map();
  const folders = new Set();
  return {
    files,
    folders,
    fail: false,
    async exists(path) {
      return files.has(path) || folders.has(path);
    },
    async read(path) {
      if (!files.has(path)) throw new Error("missing");
      return files.get(path);
    },
    async write(path, text) {
      if (this.fail) throw new Error("disk full");
      files.set(path, text);
    },
    async mkdir(path) {
      folders.add(path);
    },
    async process(path, fn) {
      const text = fn(await this.read(path));
      await this.write(path, text);
      return text;
    },
  };
}
test("store stays sparse and merges latest manual edits on every update", async () => {
  const adapter = memory(),
    store = new OrderStore(adapter, "Meta/order.json", ["Images"]);
  await store.load();
  assert.equal(adapter.files.get(store.path), "{}\n");
  adapter.files.set(store.path, '{"Manual": ["中文.md"], "Images": ["huge.png"]}');
  await store.update((order) => {
    order.A = ["C.md", "B.md"];
    return order;
  });
  assert.deepEqual(store.order.Manual, ["中文.md"]);
  assert.equal(store.order.Images, undefined);
  assert.equal(Object.keys(store.order).length, 2);
});
test("invalid external JSON and failed writes retain last good state and never overwrite bad input", async () => {
  const adapter = memory(),
    store = new OrderStore(adapter, "order.json", []);
  await store.load();
  await store.update((order) => {
    order.A = ["B.md"];
    return order;
  });
  adapter.fail = true;
  await assert.rejects(
    store.update((order) => {
      order.A = ["C.md"];
      return order;
    }),
  );
  assert.deepEqual(store.order.A, ["B.md"]);
  adapter.fail = false;
  adapter.files.set("order.json", '{"A": [');
  await assert.rejects(store.load());
  await assert.rejects(store.update((order) => order));
  assert.equal(adapter.files.get("order.json"), '{"A": [');
  assert.deepEqual(store.order.A, ["B.md"]);
});
test("switching paths loads existing order, copies new paths and rejects malformed target", async () => {
  const adapter = memory(),
    store = new OrderStore(adapter, "original.json", []);
  await store.load();
  await store.update((order) => {
    order.A = ["B.md"];
    return order;
  });
  await store.switchPath("Meta/copy.json");
  assert.deepEqual(store.order.A, ["B.md"]);
  assert.ok(adapter.files.has("original.json"));
  adapter.files.set("other.json", '{"Z": ["Q.md"]}');
  await store.switchPath("other.json");
  assert.deepEqual(store.order.Z, ["Q.md"]);
  adapter.files.set("bad.json", "bad");
  await assert.rejects(store.switchPath("bad.json"));
  assert.equal(store.path, "other.json");
});
test("serialized updates do not lose independent folders", async () => {
  const adapter = memory(),
    store = new OrderStore(adapter, "order.json", []);
  await store.load();
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      store.update((order) => {
        order["Folder" + i] = ["Note.md"];
        return order;
      }),
    ),
  );
  assert.equal(Object.keys(store.order).length, 25);
});
