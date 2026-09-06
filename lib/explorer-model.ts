/** Pure file-tree operations. No browser or Obsidian dependencies. */
export type FileNode = {
  id: string;
  name: string;
  kind: "file" | "folder";
  parentId: string | null;
  children: string[];
};
export type FileTree = { nodes: Record<string, FileNode>; roots: string[] };
export type TreeRow = { id: string; depth: number };
export type DropTarget = {
  parentId: string | null;
  beforeId: string | null;
  depth: number;
  kind: "insert" | "inside";
};
export type Scenario = "boundary" | "nested" | "scroll";
export const scenarios = [
  {
    id: "boundary" as const,
    name: "目录边界",
    detail: "A / B、C 与 D / E",
    instruction: "把 B 拖到 C 下方，试着分别放在 A 内，或移至 A 与 D 之间。",
  },
  {
    id: "nested" as const,
    name: "多层目录",
    detail: "嵌套、空目录与长文件名",
    instruction: "试试把文件移入空目录，或从第三层拖回根目录。拖动文件夹时，其内容会一起移动。",
  },
  {
    id: "scroll" as const,
    name: "长列表",
    detail: "滚动、悬停展开与首尾插入",
    instruction: "拖动时靠近列表上下边缘可自动滚动。停留在折叠目录中部，会自动展开目录。",
  },
];
export function childrenOf(tree: FileTree, parentId: string | null): string[] {
  return parentId === null ? tree.roots : (tree.nodes[parentId]?.children ?? []);
}
export function nodePath(tree: FileTree, id: string | null): string {
  if (id === null) return "根目录";
  const parts: string[] = [];
  let current: string | null = id;
  while (current !== null && tree.nodes[current]) {
    parts.unshift(tree.nodes[current].name);
    current = tree.nodes[current].parentId;
  }
  return parts.join(" / ");
}
export function isInSubtree(tree: FileTree, id: string | null, ancestor: string): boolean {
  let current = id;
  while (current !== null && tree.nodes[current]) {
    if (current === ancestor) return true;
    current = tree.nodes[current].parentId;
  }
  return false;
}
export function flattenTree(tree: FileTree, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  function visit(ids: string[], depth: number) {
    for (const id of ids) {
      rows.push({ id, depth });
      if (expanded.has(id)) visit(tree.nodes[id].children, depth + 1);
    }
  }
  visit(tree.roots, 0);
  return rows;
}
export function validateMove(tree: FileTree, id: string, target: DropTarget): string | null {
  if (!tree.nodes[id]) return "找不到这个文件";
  if (target.parentId !== null && tree.nodes[target.parentId]?.kind !== "folder")
    return "目标不是文件夹";
  if (isInSubtree(tree, target.parentId, id)) return "不能放入自身或自己的子目录";
  if (target.beforeId !== null && !childrenOf(tree, target.parentId).includes(target.beforeId))
    return "插入位置已变化";
  return null;
}
export function moveNode(
  tree: FileTree,
  id: string,
  target: DropTarget,
): { tree: FileTree; changed: boolean; type: "reorder" | "move" } {
  const error = validateMove(tree, id, target);
  if (error) throw new Error(error);
  const sourceParent = tree.nodes[id].parentId;
  const type = sourceParent === target.parentId ? "reorder" : "move";
  if (target.beforeId === id) return { tree, changed: false, type };
  const next = structuredClone(tree);
  const source = childrenOf(next, sourceParent);
  source.splice(source.indexOf(id), 1);
  const destination = childrenOf(next, target.parentId);
  destination.splice(
    target.beforeId === null ? destination.length : destination.indexOf(target.beforeId),
    0,
    id,
  );
  next.nodes[id].parentId = target.parentId;
  const changed =
    sourceParent !== target.parentId ||
    childrenOf(tree, sourceParent).join("\0") !== childrenOf(next, sourceParent).join("\0");
  return { tree: changed ? next : tree, changed, type };
}
/** Both sides of the source represent the same unchanged order. No cloning on pointer movement. */
export function isNoopMove(tree: FileTree, id: string, target: DropTarget): boolean {
  const node = tree.nodes[id];
  if (!node || node.parentId !== target.parentId) return false;
  const siblings = childrenOf(tree, node.parentId);
  return target.beforeId === id || target.beforeId === (siblings[siblings.indexOf(id) + 1] ?? null);
}
/** All structurally possible parents at a visible gap, deepest first. */
export function gapTargets(
  tree: FileTree,
  rows: TreeRow[],
  gap: number,
  draggedId: string,
): DropTarget[] {
  if (gap < 0 || gap > rows.length) return [];
  if (gap === 0)
    return [
      {
        parentId: null,
        beforeId: tree.roots[0] ?? null,
        depth: 0,
        kind: "insert",
      },
    ];
  const previous = rows[gap - 1];
  const next = rows[gap];
  const targets: DropTarget[] = [];
  if (next && next.depth > previous.depth) {
    targets.push({
      parentId: previous.id,
      beforeId: next.id,
      depth: next.depth,
      kind: "insert",
    });
  } else {
    let current: string | null = previous.id;
    let depth = previous.depth;
    while (current !== null && (!next || next.depth <= depth)) {
      const n: FileNode = tree.nodes[current];
      const siblings = childrenOf(tree, n.parentId);
      targets.push({
        parentId: n.parentId,
        beforeId: siblings[siblings.indexOf(current) + 1] ?? null,
        depth,
        kind: "insert",
      });
      current = n.parentId;
      depth -= 1;
    }
    // An expanded empty folder has no child row; its center remains the explicit entry point.
  }
  return targets.filter((t) => !validateMove(tree, draggedId, t));
}
export function insideTarget(tree: FileTree, id: string, depth: number): DropTarget {
  return { parentId: id, beforeId: null, depth: depth + 1, kind: "inside" };
}
export function describeTarget(
  tree: FileTree,
  target: DropTarget,
  draggedId: string,
): { path: string; position: string; label: string } {
  const path = nodePath(tree, target.parentId);
  const ids = childrenOf(tree, target.parentId).filter((id) => id !== draggedId);
  let before = target.beforeId;
  if (before === draggedId) {
    const original = childrenOf(tree, target.parentId);
    before = original[original.indexOf(draggedId) + 1] ?? null;
  }
  const index = before === null ? ids.length : ids.indexOf(before);
  const prev = index > 0 ? tree.nodes[ids[index - 1]].name : null;
  const next = before ? tree.nodes[before]?.name : null;
  const position =
    prev && next
      ? `${prev} 与 ${next} 之间`
      : prev
        ? `${prev} 之后`
        : next
          ? `${next} 之前`
          : "第一个位置";
  return {
    path,
    position,
    label: target.kind === "inside" ? `移入 ${path} · ${position}` : `${path} · ${position}`,
  };
}
export function targetKey(t: DropTarget): string {
  return `${t.parentId ?? "$root"}:${t.beforeId ?? "$end"}:${t.kind}`;
}
export function createScenario(scenario: Scenario): {
  tree: FileTree;
  expanded: Set<string>;
} {
  const tree: FileTree = { nodes: {}, roots: [] };
  const expanded = new Set<string>();
  function add(
    id: string,
    name: string,
    parentId: string | null = null,
    folder = false,
    open = true,
  ) {
    tree.nodes[id] = {
      id,
      name,
      parentId,
      kind: folder ? "folder" : "file",
      children: [],
    };
    childrenOf(tree, parentId).push(id);
    if (folder && open) expanded.add(id);
  }
  if (scenario === "boundary") {
    add("a", "A", null, true);
    add("b", "B", "a");
    add("c", "C", "a");
    add("d", "D", null, true);
    add("e", "E", "d");
    add("inbox", "收件箱", null, true);
    add("guide", "交互设计笔记");
  } else if (scenario === "nested") {
    add("projects", "项目", null, true);
    add("design", "交互设计", "projects", true);
    add("drafts", "草稿", "design", true);
    add("gesture", "手势与拖放", "drafts");
    add("long", "关于目录边界与层级归属的交互设计研究笔记", "drafts");
    add("research", "用户访谈", "design");
    add("dev", "开发记录", "projects");
    add("inbox", "收件箱", null, true);
    add("archive", "归档", null, true, false);
    add("old", "旧版方案", "archive");
    add("guide", "交互设计笔记");
  } else {
    add("inbox", "收件箱", null, true);
    for (let i = 1; i <= 18; i++)
      add(
        `note-${i}`,
        `${String(i).padStart(2, "0")} · ${["阅读摘录", "灵感随记", "设计观察", "本周计划", "工作日志", "会议记录"][(i - 1) % 6]}`,
        "inbox",
      );
    add("archive", "归档", null, true, false);
    add("old", "上个月的记录", "archive");
    add("deep", "往期项目", "archive", true, false);
    add("old-plan", "早期计划", "deep");
    add("empty", "待整理", null, true);
    for (let i = 19; i <= 27; i++) add(`note-${i}`, `${i} · 独立笔记`);
    add("guide", "交互设计笔记");
  }
  return { tree, expanded };
}
