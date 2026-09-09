import {
  gapTargets,
  insideTarget,
  isInSubtree,
  isNoopMove,
  validateMove,
  type DropTarget,
  type FileTree,
  type TreeRow,
} from "./explorer-model.ts";
import { nearestGap, type GapBand } from "./drag-geometry.ts";

export type DragHit = {
  target: DropTarget | null;
  band: GapBand | null;
  candidates: DropTarget[];
  invalid: string | null;
  noOp: boolean;
};
export const emptyHit: DragHit = {
  target: null,
  band: null,
  candidates: [],
  invalid: null,
  noOp: false,
};
export function normalizeHit(
  tree: FileTree,
  rows: TreeRow[],
  id: string,
  hit: Omit<DragHit, "noOp">,
): DragHit {
  const noOp = !!hit.target && isNoopMove(tree, id, hit.target);
  if (!noOp) return { ...hit, noOp };
  const node = tree.nodes[id];
  const row = rows.find((r) => r.id === id);
  return {
    ...hit,
    noOp: true,
    target: {
      parentId: node.parentId,
      beforeId: id,
      depth: row?.depth ?? 0,
      kind: "insert",
    },
  };
}
export function chooseDepth(candidates: DropTarget[], x: number, choice: number): number {
  const center = (index: number) => 30 + candidates[index].depth * 22;
  const closest = candidates.reduce(
    (best, _t, i) => (Math.abs(center(i) - x) < Math.abs(center(best) - x) ? i : best),
    choice,
  );
  if (closest === choice) return choice;
  const midpoint = (center(closest) + center(choice)) / 2;
  return center(closest) > center(choice)
    ? x > midpoint + 6
      ? closest
      : choice
    : x < midpoint - 6
      ? closest
      : choice;
}
/** Inputs are tree-local coordinates. Visual overlays cannot feed back into this function. */
export function resolveTreeHit(
  tree: FileTree,
  rows: TreeRow[],
  id: string,
  rowHeight: number,
  x: number,
  y: number,
  previous: DragHit = emptyHit,
  horizontal = false,
): DragHit {
  if (!rows.length) return emptyHit;
  const index = Math.max(0, Math.min(rows.length - 1, Math.floor(y / rowHeight)));
  const row = rows[index],
    fraction = (y - index * rowHeight) / rowHeight;
  const node = tree.nodes[row.id];
  const sourceBoundary =
    row.id === id &&
    (fraction < 0.25 || fraction > 0.75) &&
    gapTargets(tree, rows, Math.round(y / rowHeight), id).length > 1;
  if (row.id === id && fraction >= 0 && fraction <= 1 && !sourceBoundary) {
    return normalizeHit(tree, rows, id, {
      ...emptyHit,
      target: {
        parentId: node.parentId,
        beforeId: id,
        depth: row.depth,
        kind: "insert",
      },
    });
  }
  const wasInside = previous.target?.kind === "inside" && previous.target.parentId === row.id;
  if (
    row.id !== id &&
    node.kind === "folder" &&
    fraction > (wasInside ? 0.2 : 0.32) &&
    fraction < (wasInside ? 0.8 : 0.68)
  ) {
    const target = insideTarget(tree, row.id, row.depth),
      error = validateMove(tree, id, target);
    return normalizeHit(tree, rows, id, {
      ...emptyHit,
      target: error ? null : target,
      invalid: error,
    });
  }
  if (isInSubtree(tree, row.id, id) && fraction > 0.25 && fraction < 0.75)
    return { ...emptyHit, invalid: "不能放入自身或自己的子目录" };
  const gap = nearestGap(y, rowHeight, rows.length, previous.band?.gap ?? null);
  const candidates = gapTargets(tree, rows, gap, id);
  if (!candidates.length) return { ...emptyHit, invalid: "不能放入自身或自己的子目录" };
  const same = candidates.findIndex((t) => t.parentId === tree.nodes[id].parentId);
  let choice =
    previous.band?.gap === gap
      ? Math.min(previous.band.choice, candidates.length - 1)
      : Math.max(0, same);
  if (horizontal) choice = chooseDepth(candidates, x, choice);
  return normalizeHit(tree, rows, id, {
    target: candidates[choice],
    band: { gap, count: candidates.length, choice },
    candidates,
    invalid: null,
  });
}
