import { TFolder, type App, type TAbstractFile } from "obsidian";
import { flattenTree, type FileTree, type TreeRow } from "../lib/explorer-model";
import type { DataStore } from "./data";
import { excluded, sortItems } from "./order";

export interface NativeItem {
  file: TAbstractFile;
  selfEl: HTMLElement;
  collapsed?: boolean;
  setCollapsed?(value: boolean): Promise<void>;
}
export interface NativeExplorer {
  containerEl: HTMLElement;
  navFileContainerEl: HTMLElement;
  fileItems: Record<string, NativeItem>;
  getSortedFolderItems: (this: NativeExplorer, folder: TFolder) => NativeItem[];
  requestSort(): void;
  sort(): void;
  searchQuery?: string;
  onFilePointerout?(event: PointerEvent, el: HTMLElement): void;
}
export interface Snapshot {
  tree: FileTree;
  rows: TreeRow[];
}
/** Check capabilities rather than assuming all Obsidian versions expose internals. */
export function compatibleExplorer(value: unknown): value is NativeExplorer {
  const view = value as Partial<NativeExplorer> | null;
  const root = view?.navFileContainerEl;
  const realm = root?.ownerDocument?.defaultView as (Window & typeof window) | null;
  return !!(
    realm &&
    typeof realm.ResizeObserver === "function" &&
    typeof realm.MutationObserver === "function" &&
    typeof realm.PointerEvent === "function" &&
    typeof realm.requestAnimationFrame === "function" &&
    typeof (root as unknown as { querySelectorAll?: unknown })?.querySelectorAll === "function" &&
    typeof view?.getSortedFolderItems === "function" &&
    typeof view.requestSort === "function" &&
    view.fileItems &&
    typeof view.fileItems === "object"
  );
}

const sortingPlugins: Record<string, string> = {
  flexplorer: "Flexplorer",
  "manual-sorting": "Manual Sorting",
  "custom-sort": "Custom File Explorer sorting",
  "file-explorer-plus": "File Explorer++",
};
export function sortConflicts(enabled: Iterable<string>): string[] {
  return Array.from(enabled)
    .filter((id) => Object.hasOwn(sortingPlugins, id))
    .sort()
    .map((id) => sortingPlugins[id]);
}
export function snapshot(app: App, view: NativeExplorer): Snapshot {
  const tree: FileTree = {
    nodes: Object.create(null) as FileTree["nodes"],
    roots: [],
  };
  const expanded = new Set<string>();
  function visit(folder: TFolder, depth: number) {
    const children = view.getSortedFolderItems(folder).map((item) => item.file);
    const ids = children.map((file) => file.path);
    if (folder.isRoot()) tree.roots = ids;
    else tree.nodes[folder.path].children = ids;
    for (const file of children) {
      tree.nodes[file.path] = {
        id: file.path,
        name: file.name,
        parentId: folder.isRoot() ? null : folder.path,
        kind: file instanceof TFolder ? "folder" : "file",
        children: [],
      };
      if (file instanceof TFolder && view.fileItems[file.path]?.collapsed === false) {
        expanded.add(file.path);
        visit(file, depth + 1);
      }
    }
  }
  visit(app.vault.getRoot(), 0);
  return { tree, rows: flattenTree(tree, expanded) };
}
export function attachSort(
  view: NativeExplorer,
  store: DataStore,
  onError: (error: unknown) => void = console.error,
): () => void {
  if (!compatibleExplorer(view)) throw new Error("unavailable");
  const original = view.getSortedFolderItems;
  const hadOwn = Object.hasOwn(view, "getSortedFolderItems");
  let active = true;
  const failed = new Set<string>();
  function report(folder: TFolder, error: unknown) {
    if (!failed.has(folder.path)) {
      failed.add(folder.path);
      onError(error);
    }
  }
  function sorted(this: NativeExplorer, folder: TFolder): NativeItem[] {
    if (!active) return original.call(this, folder);
    let items: NativeItem[];
    try {
      items = original.call(this, folder);
      if (!Array.isArray(items) || items.some((item) => typeof item?.file?.name !== "string"))
        throw new Error("unavailable");
    } catch (error) {
      // Never hide a whole folder just because an upstream sorter failed.
      // Preserve the known native items; do not invent DOM rows.
      report(folder, error);
      return folder.children.map((file) => this.fileItems[file.path]).filter(Boolean);
    }
    try {
      if (!active || excluded(folder.path, store.rules)) return items;
      const result = sortItems(items, store.order[folder.path], (item) => item.file.name);
      failed.delete(folder.path);
      return result;
    } catch (error) {
      report(folder, error);
      return items;
    }
  }
  view.getSortedFolderItems = sorted;
  const restore = () => {
    active = false;
    if (view.getSortedFolderItems === sorted) {
      if (hadOwn) view.getSortedFolderItems = original;
      else delete (view as Partial<NativeExplorer>).getSortedFolderItems;
    }
    try {
      view.requestSort();
    } catch (error) {
      onError(error);
    }
  };
  try {
    view.requestSort();
  } catch (error) {
    restore();
    throw error;
  }
  return restore;
}
