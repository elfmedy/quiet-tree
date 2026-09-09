import test from "node:test";
import assert from "node:assert/strict";
import {
  createScenario,
  flattenTree,
  gapTargets,
  moveNode,
  validateMove,
  nodePath,
  describeTarget,
  insideTarget,
  childrenOf,
} from "../lib/explorer-model.ts";
import {
  rowTop,
  nearestGap,
  makeBoundaryPicker,
  pickerHit,
  pressIntent,
} from "../lib/drag-geometry.ts";
import { resolveTreeHit, emptyHit, chooseDepth } from "../lib/drag-hit-test.ts";

test("last source row exposes its folder boundary while its center stays a quiet no-op", () => {
  const { tree, expanded } = createScenario("boundary");
  const rows = flattenTree(tree, expanded);
  const index = rows.findIndex((row) => row.id === "c");
  const center = resolveTreeHit(tree, rows, "c", 36, 64, (index + 0.5) * 36);
  assert.equal(center.noOp, true);
  assert.equal(center.band, null);
  const edge = resolveTreeHit(tree, rows, "c", 36, 64, (index + 0.9) * 36, center);
  assert.deepEqual(
    edge.candidates.map((t) => t.parentId),
    ["a", null],
  );
  assert.equal(edge.noOp, true);
  assert.equal(moveNode(tree, "c", edge.candidates[0]).changed, false);
  assert.equal(moveNode(tree, "c", edge.candidates[1]).changed, true);
  assert.deepEqual(resolveTreeHit(tree, rows, "c", 36, 64, (index + 0.9) * 36, edge), edge);
});

const destination = (parentId, beforeId = null) => ({
  parentId,
  beforeId,
  depth: 0,
  kind: "insert",
});

test("C / D boundary has distinct A and root destinations", () => {
  const { tree, expanded } = createScenario("boundary");
  const rows = flattenTree(tree, expanded);
  const choices = gapTargets(tree, rows, 3, "b");
  assert.deepEqual(
    choices.map((t) => [t.parentId, t.beforeId, t.depth]),
    [
      ["a", null, 1],
      [null, "d", 0],
    ],
  );
  assert.equal(describeTarget(tree, choices[0], "b").label, "A · C 之后");
  assert.equal(describeTarget(tree, choices[1], "b").label, "根目录 · A 与 D 之间");
});
test("reorder B after C preserves the parent and original immutable tree", () => {
  const { tree } = createScenario("boundary");
  const result = moveNode(tree, "b", destination("a"));
  assert.equal(result.type, "reorder");
  assert.equal(result.changed, true);
  assert.deepEqual(result.tree.nodes.a.children, ["c", "b"]);
  assert.deepEqual(tree.nodes.a.children, ["b", "c"]);
  assert.equal(result.tree.nodes.b.parentId, "a");
});
test("move B between A and D changes parent and root order", () => {
  const { tree } = createScenario("boundary");
  const result = moveNode(tree, "b", destination(null, "d"));
  assert.equal(result.type, "move");
  assert.deepEqual(result.tree.roots, ["a", "b", "d", "inbox", "guide"]);
  assert.deepEqual(result.tree.nodes.a.children, ["c"]);
  assert.equal(result.tree.nodes.b.parentId, null);
});
test("first, last, empty and collapsed destinations are usable", () => {
  const { tree } = createScenario("nested");
  const empty = moveNode(tree, "gesture", destination("inbox")).tree;
  assert.deepEqual(empty.nodes.inbox.children, ["gesture"]);
  const first = moveNode(empty, "gesture", destination(null, "projects")).tree;
  assert.equal(first.roots[0], "gesture");
  const last = moveNode(first, "gesture", destination(null)).tree;
  assert.equal(last.roots.at(-1), "gesture");
  const collapsed = moveNode(last, "gesture", insideTarget(last, "archive", 0)).tree;
  assert.deepEqual(collapsed.nodes.archive.children, ["old", "gesture"]);
});
test("moving a folder carries its subtree and updates descendant paths", () => {
  const { tree } = createScenario("nested");
  const next = moveNode(tree, "design", destination("archive")).tree;
  assert.deepEqual(next.nodes.design.children, tree.nodes.design.children);
  assert.equal(nodePath(next, "gesture"), "归档 / 交互设计 / 草稿 / 手势与拖放");
  assert.equal(next.nodes.gesture.parentId, "drafts");
});
test("self, descendants, missing parents and non-sibling anchors are rejected", () => {
  const { tree } = createScenario("nested");
  const snapshot = JSON.stringify(tree);
  for (const target of [
    destination("projects"),
    destination("drafts"),
    destination("gesture"),
    destination("missing"),
    destination("archive", "gesture"),
  ]) {
    assert.ok(validateMove(tree, "projects", target));
    assert.throws(() => moveNode(tree, "projects", target));
  }
  assert.equal(JSON.stringify(tree), snapshot);
});
test("no-op moves do not create a new tree or undo step", () => {
  const { tree } = createScenario("boundary");
  for (const target of [destination("a", "b"), destination("a", "c")]) {
    const result = moveNode(tree, "b", target);
    assert.equal(result.changed, false);
    assert.equal(result.tree, tree);
  }
  assert.equal(moveNode(tree, "c", destination("a")).changed, false);
});
test("nested boundary enumerates only structurally possible ancestor levels", () => {
  const { tree, expanded } = createScenario("nested");
  const rows = flattenTree(tree, expanded);
  const gap = rows.findIndex((r) => r.id === "long") + 1;
  assert.deepEqual(
    gapTargets(tree, rows, gap, "guide").map((t) => [t.parentId, t.beforeId]),
    [
      ["drafts", null],
      ["design", "research"],
    ],
  );
  const lastGap = rows.findIndex((r) => r.id === "dev") + 1;
  assert.deepEqual(
    gapTargets(tree, rows, lastGap, "guide").map((t) => t.parentId),
    ["projects", null],
  );
});
test("collapsed descendants never leak into visible gaps", () => {
  const { tree, expanded } = createScenario("nested");
  const rows = flattenTree(tree, expanded);
  assert.equal(
    rows.some((r) => r.id === "old"),
    false,
  );
  const gap = rows.findIndex((r) => r.id === "archive") + 1;
  assert.deepEqual(
    gapTargets(tree, rows, gap, "gesture").map((t) => t.parentId),
    [null],
  );
});
test("every offered gap preserves all nodes, unique ownership and an acyclic tree", () => {
  for (const scenario of ["boundary", "nested", "scroll"]) {
    const { tree, expanded } = createScenario(scenario);
    const rows = flattenTree(tree, expanded);
    for (const id of Object.keys(tree.nodes))
      for (let gap = 0; gap <= rows.length; gap++)
        for (const target of gapTargets(tree, rows, gap, id)) {
          const next = moveNode(tree, id, target).tree;
          const full = flattenTree(next, new Set(Object.keys(next.nodes)));
          assert.equal(full.length, Object.keys(tree.nodes).length);
          assert.equal(new Set(full.map((r) => r.id)).size, full.length);
          for (const node of Object.values(next.nodes))
            assert.equal(childrenOf(next, node.parentId).filter((x) => x === node.id).length, 1);
        }
  }
});
test("regression: moving around both sides of B keeps one unchanged target and every row stationary", () => {
  const { tree, expanded } = createScenario("boundary");
  const rows = flattenTree(tree, expanded);
  const original = rows.map((_, i) => rowTop(i, 36));
  let hit = emptyHit;
  // Sweep between the bottom of A and the upper half of C, repeatedly reversing direction.
  const path = [32, 35, 40, 54, 65, 71, 74, 80, 84, 80, 72, 66, 54, 40, 35, 32];
  for (let lap = 0; lap < 30; lap++)
    for (const y of path) {
      hit = resolveTreeHit(tree, rows, "b", 36, 70, y, hit);
      assert.equal(hit.noOp, true, `at y=${y}`);
      assert.equal(hit.target.parentId, "a");
      assert.equal(hit.target.beforeId, "b");
      assert.deepEqual(
        rows.map((_, i) => rowTop(i, 36)),
        original,
      );
      assert.equal(moveNode(tree, "b", hit.target).changed, false);
    }
});
test("regression: stationary pointer has no target feedback loop, across all visible rows and scenarios", () => {
  for (const scenario of ["boundary", "nested", "scroll"]) {
    const { tree, expanded } = createScenario(scenario);
    const rows = flattenTree(tree, expanded);
    let previous = emptyHit;
    for (let y = 0; y < rows.length * 36; y += 3) {
      const first = resolveTreeHit(tree, rows, "guide", 36, 90, y, previous);
      let next = first;
      for (let frame = 0; frame < 8; frame++) {
        next = resolveTreeHit(tree, rows, "guide", 36, 90, y, next);
        assert.deepEqual(next, first, `${scenario}, y=${y}, frame=${frame}`);
      }
      previous = next;
    }
  }
});
test("midpoint jitter retains a gap until the pointer crosses the buffer", () => {
  assert.equal(nearestGap(91, 36, 7, 2), 2);
  assert.equal(nearestGap(95, 36, 7, 2), 2);
  assert.equal(nearestGap(96, 36, 7, 2), 3);
  const { tree, expanded } = createScenario("boundary");
  const rows = flattenTree(tree, expanded);
  let hit = resolveTreeHit(tree, rows, "b", 36, 60, 82);
  for (const y of [88, 91, 89, 93, 88, 94]) {
    hit = resolveTreeHit(tree, rows, "b", 36, 60, y, hit);
    assert.equal(hit.noOp, true);
  }
  hit = resolveTreeHit(tree, rows, "b", 36, 60, 100, hit);
  assert.equal(hit.noOp, false);
  assert.equal(hit.band.gap, 3);
  assert.deepEqual(
    hit.candidates.map((c) => c.parentId),
    ["a", null],
  );
});
test("B below C retains both outcomes with no additional canvas height", () => {
  const { tree, expanded } = createScenario("boundary");
  const rows = flattenTree(tree, expanded);
  const hit = resolveTreeHit(tree, rows, "b", 36, 64, 106);
  assert.deepEqual(
    hit.candidates.map((t) => [t.parentId, t.beforeId]),
    [
      ["a", null],
      [null, "d"],
    ],
  );
  assert.deepEqual(moveNode(tree, "b", hit.candidates[0]).tree.nodes.a.children, ["c", "b"]);
  assert.deepEqual(moveNode(tree, "b", hit.candidates[1]).tree.roots.slice(0, 3), ["a", "b", "d"]);
  assert.equal(rowTop(3, 36), 108);
});
test("folder combine has its own enter/exit buffer and does not oscillate", () => {
  const { tree, expanded } = createScenario("boundary");
  const rows = flattenTree(tree, expanded);
  let hit = resolveTreeHit(tree, rows, "b", 36, 60, 126);
  assert.equal(hit.target.kind, "inside");
  assert.equal(hit.target.parentId, "d");
  for (const y of [118, 119, 120, 117, 119]) {
    hit = resolveTreeHit(tree, rows, "b", 36, 60, y, hit);
    assert.equal(hit.target.kind, "inside");
  }
  hit = resolveTreeHit(tree, rows, "b", 36, 60, 111, hit);
  assert.equal(hit.target.kind, "insert");
});
test("picker does not select an option when it appears under an unmoved pointer", () => {
  const rect = { left: 20, top: 120, width: 330, height: 450 };
  const p = makeBoundaryPicker(rect, 480, 3, 0, 44, 390, 640, 120, 480, 0);
  assert.equal(p.side, "below");
  assert.ok(p.left >= 8);
  assert.ok(p.top + p.height <= 632);
  assert.equal(pickerHit(p, p.left + 50, p.top + p.header + 70, 3, 0), "bridge");
  const armed = { ...p, armed: true };
  assert.equal(pickerHit(armed, p.left + 50, p.top + p.header + 70, 3, 0), 1);
  assert.equal(pickerHit(armed, p.left + 50, p.top + p.header + 45, 3, 0), 0);
  assert.equal(pickerHit(armed, p.left + 50, p.top + p.header + 51, 3, 0), 1);
});
test("desktop chooser has a reachable bridge, and leaving it clears the hit", () => {
  const p = makeBoundaryPicker(
    { left: 50, top: 100, width: 280, height: 450 },
    210,
    2,
    0,
    44,
    1280,
    800,
    305,
    210,
    0,
  );
  assert.equal(p.side, "right");
  assert.equal(pickerHit(p, 328, 210, 2, 0), "bridge");
  assert.equal(pickerHit(p, 900, 700, 2, 0), null);
  assert.equal(pickerHit(p, (p.originX + p.left) / 2, p.originY + 18, 2, 0), "bridge");
  assert.equal(pickerHit({ ...p, armed: true }, p.left + 30, p.top + 30 + 66, 2, 0), 1);
});
test("horizontal hierarchy choice tolerates small horizontal tremors", () => {
  const candidates = [destination("a"), destination(null)];
  candidates[0].depth = 1;
  let choice = 0;
  for (const x of [44, 42, 40, 38, 41]) {
    choice = chooseDepth(candidates, x, choice);
    assert.equal(choice, 0);
  }
  assert.equal(chooseDepth(candidates, 30, choice), 1);
});
test("mouse activation requires both delay and movement", () => {
  assert.equal(pressIntent("mouse", 100, 25, 180), "pending");
  assert.equal(pressIntent("mouse", 200, 0, 180), "pending");
  assert.equal(pressIntent("mouse", 200, 5, 180), "dragging");
});
test("touch movement before activation cancels preparation and preserves scroll intent", () => {
  assert.equal(pressIntent("touch", 100, 9, 350), "cancelled");
  assert.equal(pressIntent("touch", 349, 0, 350), "pending");
  assert.equal(pressIntent("touch", 350, 2, 350), "dragging");
});
