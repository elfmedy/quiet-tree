import { childrenOf, type FileTree, type DropTarget } from "../lib/explorer-model";
import type { TextKey } from "./i18n";

export const displayName = (name: string): string => name.replace(/\.md$/i, "");
export function destinationLabel(
  tree: FileTree,
  target: DropTarget,
  source: string,
  t: (key: TextKey) => string,
) {
  const original = childrenOf(tree, target.parentId);
  const siblings = original.filter((id) => id !== source);
  const before =
    target.beforeId === source ? (original[original.indexOf(source) + 1] ?? null) : target.beforeId;
  const index = before === null ? siblings.length : siblings.indexOf(before);
  const previous = index > 0 ? tree.nodes[siblings[index - 1]] : null;
  const next = before ? tree.nodes[before] : null;
  const format = (key: TextKey) =>
    t(key)
      .replace("{previous}", displayName(previous?.name ?? ""))
      .replace("{next}", displayName(next?.name ?? ""));
  return {
    directory: target.parentId ? tree.nodes[target.parentId].name : t("root"),
    path: target.parentId ?? t("root"),
    position:
      previous && next
        ? format("positionBetween")
        : previous
          ? format("positionAfter")
          : next
            ? format("positionBefore")
            : t("positionFirst"),
  };
}
