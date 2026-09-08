import test from "node:test";
import { destinationLabel } from "../src/presentation.ts";
import { translate } from "../src/i18n.ts";
import { createScenario } from "../lib/explorer-model.ts";
import assert from "node:assert/strict";
import { readSettings, loadSettings } from "../src/settings-data.ts";
import { DataStore, readOrderState } from "../src/data.ts";

test("desktop and touch delays are independent and customized values are preserved", () => {
  const defaults = loadSettings(null, ["assets"]);
  assert.equal(defaults.delay, 500);
  assert.equal(defaults.mouseDelay, 200);
  assert.equal(loadSettings({ delay: 350 }, []).delay, 350);
  assert.equal(loadSettings({ delay: 610, mouseDelay: 270 }, []).mouseDelay, 270);
  assert.deepEqual(readSettings({ mouseDelay: 50 }), { mouseDelay: 180 });
  assert.deepEqual(readSettings({ mouseDelay: NaN }), {});
});

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

function memory(data = null) {
  return {
    data,
    fail: false,
    writes: 0,
    async load() {
      return structuredClone(this.data);
    },
    async save(next) {
      if (this.fail) throw Error("disk full");
      this.data = structuredClone(next);
      this.writes++;
    },
  };
}
const snapshot = (order) => [1, Object.entries(order)];
test("snapshot is a single versioned array and rejects partial, duplicate or malformed orders", () => {
  assert.deepEqual(readOrderState(snapshot({ "/": ["中文.md"], A: ["B.md"] })).A, ["B.md"]);
  for (const state of [
    null,
    {},
    [2, []],
    [1],
    [1, {}, []],
    [
      1,
      [
        ["A", []],
        ["A", []],
      ],
    ],
    [1, [["A", ["B", "B"]]]],
    [1, [["../A", []]]],
    [1, [["A", ["a/b"]]]],
  ])
    assert.throws(() => readOrderState(state));
  assert.deepEqual(readOrderState([1, [["__proto__", ["constructor"]]]]).__proto__, [
    "constructor",
  ]);
});
test("new device loads without writing defaults; old standalone format is not consumed", async () => {
  const io = memory(),
    store = new DataStore(io, ["assets"]);
  await store.load();
  assert.equal(io.writes, 0);
  assert.equal(io.data, null);
  io.data = { jsonPath: "old.json", delay: 350 };
  await assert.rejects(store.load());
  await assert.rejects(store.saveSettings({ language: "en" }));
  assert.equal(io.writes, 0);
});
test("settings and order writes share one queue and preserve latest synced fields", async () => {
  const io = memory(),
    store = new DataStore(io, ["assets"]);
  await store.load();
  await Promise.all([
    store.saveSettings({ language: "en", mouseDelay: 280 }),
    ...Array.from({ length: 25 }, (_, i) =>
      store.update((order) => {
        order["Folder" + i] = ["Note.md"];
        return order;
      }),
    ),
    store.saveSettings({ delay: 630 }),
  ]);
  assert.equal(Object.keys(store.order).length, 25);
  assert.equal(io.data.language, "en");
  assert.equal(io.data.mouseDelay, 280);
  assert.equal(io.data.delay, 630);
  assert.ok(Array.isArray(io.data.orderState));
  io.data.language = "zh";
  io.data.orderState = snapshot({ Remote: ["新.md"], assets: ["image.png"] });
  await store.saveSettings({ trigger: "handle" });
  assert.equal(store.settings.language, "zh");
  assert.deepEqual(store.order.Remote, ["新.md"]);
  assert.equal(store.order.assets, undefined);
  await store.update((order) => {
    order.Local = ["本地.md"];
    return order;
  });
  assert.equal(io.data.trigger, "handle");
  assert.deepEqual(readOrderState(io.data.orderState).Remote, ["新.md"]);
});
test("sync replaces entire snapshot without writeback and tolerates files arriving later", async () => {
  const io = memory({ language: "en", orderState: snapshot({ Old: ["old.md"] }) });
  const store = new DataStore(io, []);
  await store.load();
  io.data = { language: "zh", orderState: snapshot({ "/": ["Future.md", "B.md", "A.md"] }) };
  assert.equal(await store.load(), true);
  assert.equal(store.order.Old, undefined);
  assert.equal(store.settings.language, "zh");
  assert.deepEqual(
    sortItems(["A.md", "B.md"], store.order["/"], (x) => x),
    ["B.md", "A.md"],
  );
  assert.deepEqual(
    sortItems(["A.md", "Future.md", "B.md"], store.order["/"], (x) => x),
    ["Future.md", "B.md", "A.md"],
  );
  assert.equal(await store.load(), false);
  assert.equal(io.writes, 0);
});
test("invalid synced data and save failures preserve both last-good settings and ordering", async () => {
  const io = memory({ trigger: "row", orderState: snapshot({ A: ["B.md"] }) });
  const store = new DataStore(io, []);
  await store.load();
  io.fail = true;
  await assert.rejects(
    store.update((order, settings) => {
      settings.trigger = "handle";
      order.A = ["C.md"];
      return order;
    }),
  );
  assert.equal(store.settings.trigger, "row");
  assert.deepEqual(store.order.A, ["B.md"]);
  io.fail = false;
  io.data.orderState = [1, [["A", ["B.md", "B.md"]]]];
  await assert.rejects(store.load());
  await assert.rejects(store.saveSettings({ delay: 700 }));
  assert.equal(io.writes, 0);
  assert.deepEqual(store.order.A, ["B.md"]);
  io.data.orderState = snapshot({ C: ["Recovered.md"] });
  await store.load();
  assert.equal(store.error, null);
  assert.deepEqual(store.order.C, ["Recovered.md"]);
});
test("exclusions and renames commit together and repeated filesystem events do not resave", async () => {
  const io = memory({
    excluded: ["A/assets"],
    orderState: snapshot({ "/": ["A"], A: ["assets", "B.md"], "A/assets": ["image.png"] }),
  });
  const store = new DataStore(io, []);
  await store.load();
  await store.update((order, settings) => {
    settings.excluded = renameExclusions(settings.excluded, "A", "D/A");
    return renameOrder(order, "A", "D/A");
  });
  assert.deepEqual(io.data.excluded, ["D/A/assets"]);
  assert.deepEqual(readOrderState(io.data.orderState)["D/A"], ["assets", "B.md"]);
  assert.equal(readOrderState(io.data.orderState)["D/A/assets"], undefined);
  const writes = io.writes;
  await store.update((order) => renameOrder(order, "A", "D/A"));
  await store.update((order) => deleteOrder(order, "A"));
  assert.equal(io.writes, writes);
  await store.saveSettings({ excluded: ["D"] });
  assert.deepEqual(io.data.orderState, [1, [["/", []]]]);
});
