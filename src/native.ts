import { TFolder, type App, type TAbstractFile } from "obsidian";
import { flattenTree, type FileTree, type TreeRow } from "../lib/explorer-model";
import { excluded, sortItems, type OrderStore } from "./order";

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
export function snapshot(app: App, view: NativeExplorer): Snapshot {
  const tree: FileTree = { nodes: Object.create(null) as FileTree["nodes"], roots: [] };
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
export function attachSort(view: NativeExplorer, store: OrderStore): () => void {
  const original = view.getSortedFolderItems;
  const hadOwn = Object.hasOwn(view, "getSortedFolderItems");
  let active = true;
  function sorted(this: NativeExplorer, folder: TFolder): NativeItem[] {
    const items = original.call(this, folder);
    if (!active || excluded(folder.path, store.rules)) return items;
    return sortItems(items, store.order[folder.path], (item) => item.file.name);
  }
  view.getSortedFolderItems = sorted;
  view.requestSort();
  return () => {
    active = false;
    if (view.getSortedFolderItems === sorted) {
      if (hadOwn) view.getSortedFolderItems = original;
      else delete (view as Partial<NativeExplorer>).getSortedFolderItems;
    }
    view.requestSort();
  };
}
