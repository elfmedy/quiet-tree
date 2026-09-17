import test from "node:test";
import assert from "node:assert/strict";
import { TFolder } from "obsidian";
import { attachSort, compatibleExplorer, sortConflicts } from "../src/native.ts";
import QuietTreePlugin from "../src/main.ts";
import { DataStore } from "../src/data.ts";

globalThis.window = globalThis;
function explorer() {
  const realm = {
    ResizeObserver() {},
    MutationObserver() {},
    PointerEvent() {},
    requestAnimationFrame() {},
  };
  const root = { ownerDocument: { defaultView: realm }, querySelectorAll() {} };
  const items = ["A.md", "B.canvas", "C.base"].map((name) => ({
    file: { name, path: name },
  }));
  const prototype = {
    getSortedFolderItems() {
      return items;
    },
  };
  const view = Object.assign(Object.create(prototype), {
    navFileContainerEl: root,
    fileItems: Object.fromEntries(items.map((item) => [item.file.path, item])),
    requestSort() {},
  });
  const folder = new TFolder(
    "/",
    items.map((item) => item.file),
  );
  return { view, folder, items, prototype };
}

test("capability checks reject missing sort, observers and detached windows", () => {
  const { view } = explorer();
  assert.equal(compatibleExplorer(view), true);
  for (const patch of [
    { requestSort: null },
    { fileItems: null },
    { getSortedFolderItems: null },
    { navFileContainerEl: {} },
  ])
    assert.equal(compatibleExplorer({ ...view, ...patch }), false);
  view.navFileContainerEl.ownerDocument.defaultView = null;
  assert.equal(compatibleExplorer(view), false);
});

test("normal sorting preserves file extensions, unknown items and inherited method restoration", () => {
  const { view, folder, items, prototype } = explorer();
  const restore = attachSort(view, {
    rules: [],
    order: { "/": ["C.base", "B.canvas"] },
  });
  assert.deepEqual(
    view.getSortedFolderItems(folder).map((item) => item.file.name),
    ["C.base", "B.canvas", "A.md"],
  );
  restore();
  assert.equal(Object.hasOwn(view, "getSortedFolderItems"), false);
  assert.equal(view.getSortedFolderItems, prototype.getSortedFolderItems);
  assert.equal(view.getSortedFolderItems(folder), items);
});

test("bad custom order falls back to native array, without affecting other folders or storage", () => {
  const { view, folder, items } = explorer();
  const order = { "/": { length: 1 }, Other: ["C.base"] };
  const errors = [];
  const restore = attachSort(view, { rules: [], order }, (error) => errors.push(error));
  assert.equal(view.getSortedFolderItems(folder), items);
  assert.equal(view.getSortedFolderItems(folder), items);
  assert.equal(errors.length, 1);
  assert.equal(view.getSortedFolderItems(new TFolder("Other"))[0].file.name, "C.base");
  assert.deepEqual(order["/"], { length: 1 });
  restore();
});

test("throwing or incompatible upstream sort preserves known native items", () => {
  for (const broken of [
    () => {
      throw Error("upstream");
    },
    () => null,
  ]) {
    const { view, folder, items } = explorer();
    view.getSortedFolderItems = broken;
    const restore = attachSort(view, { rules: [], order: {} }, () => {});
    assert.deepEqual(view.getSortedFolderItems(folder), items);
    restore();
    assert.equal(view.getSortedFolderItems, broken);
  }
});

test("unload leaves later wrappers intact and disables only our ordering", () => {
  const { view, folder, items } = explorer();
  const restore = attachSort(view, { rules: [], order: { "/": ["C.base"] } });
  const quiet = view.getSortedFolderItems;
  const later = function (folder) {
    return quiet.call(this, folder);
  };
  view.getSortedFolderItems = later;
  restore();
  assert.equal(view.getSortedFolderItems, later);
  assert.equal(view.getSortedFolderItems(folder), items);
});

test("attachment failure restores original method", () => {
  const { view, prototype } = explorer();
  view.requestSort = () => {
    throw Error("requestSort changed");
  };
  assert.throws(() => attachSort(view, { rules: [], order: {} }, () => {}));
  assert.equal(view.getSortedFolderItems, prototype.getSortedFolderItems);
  assert.equal(Object.hasOwn(view, "getSortedFolderItems"), false);
});

test("conflicts are explicit sorting plugins, not unrelated file tree decoration", () => {
  assert.deepEqual(sortConflicts(["iconize", "folder-notes", "flexplorer", "custom-sort"]), [
    "Custom File Explorer sorting",
    "Flexplorer",
  ]);
  assert.deepEqual(sortConflicts(["file-tree-alternative", "toString"]), []);
});

async function pluginFixture(initial) {
  let content = {
    dataVersion: 1,
    orderState: [1, Object.entries(initial)],
    excluded: [],
  };
  const stats = { writes: 0 };
  const plugin = new QuietTreePlugin();
  const io = {
    async load() {
      return structuredClone(content);
    },
    async save(data) {
      stats.writes++;
      content = structuredClone(data);
    },
  };
  plugin.store = new DataStore(io, []);
  await plugin.store.load();
  plugin.settings = plugin.store.settings;
  return {
    plugin,
    stats,
    io,
    content: () => Object.fromEntries(content.orderState[1]),
    external(order) {
      content.orderState = [1, Object.entries(order)];
    },
  };
}

test("a burst of renames/deletions commits once and keeps event chronology", async () => {
  const { plugin, stats, content } = await pluginFixture({
    "/": ["A", "AA"],
    A: ["1.md", "2.md"],
    "A/Sub": ["3.md"],
    AA: ["keep.md"],
  });
  plugin.changes.push(
    { kind: "rename", from: "A", to: "B" },
    { kind: "delete", path: "B/1.md" },
    { kind: "rename", from: "B/2.md", to: "B/4.base" },
    { kind: "delete", path: "B/Sub" },
  );
  await plugin.flushChanges();
  assert.equal(stats.writes, 1);
  assert.deepEqual(content(), {
    "/": ["B", "AA"],
    B: ["4.base"],
    AA: ["keep.md"],
  });
});

test("thousands of unrelated deletes cause no writes or startup cleanup of absent entries", async () => {
  const { plugin, stats, content } = await pluginFixture({
    Offline: ["not-loaded-yet.md"],
  });
  for (let i = 0; i < 3000; i++) plugin.changes.push({ kind: "delete", path: `Images/${i}.png` });
  await plugin.flushChanges();
  assert.equal(stats.writes, 0);
  assert.deepEqual(content(), { Offline: ["not-loaded-yet.md"] });
});

test("batched event save preserves external edits and atomic settings on failure", async () => {
  const { plugin, content, external, io } = await pluginFixture({
    A: ["1.md"],
  });
  external({ A: ["1.md"], Other: ["manual.md"] });
  plugin.changes.push({ kind: "rename", from: "A/1.md", to: "A/2.md" });
  await plugin.flushChanges();
  assert.deepEqual(content(), { A: ["2.md"], Other: ["manual.md"] });
  await plugin.store.saveSettings({ excluded: ["Images"] });
  io.save = async () => {
    throw Error("disk full");
  };
  plugin.changes.push({ kind: "rename", from: "Images", to: "Assets" });
  await assert.rejects(plugin.flushChanges(), /disk full/);
  assert.deepEqual(plugin.settings.excluded, ["Images"]);
});
