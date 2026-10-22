import {
  baseName,
  deleteOrders,
  excluded,
  parentPath,
  renameExclusions,
  type Order,
} from "./order";

export type FileChange =
  | { kind: "create"; path: string }
  | { kind: "rename"; from: string; to: string }
  | { kind: "delete"; path: string };
export type StableChange = FileChange & { source?: string[]; destination?: string[] };
type Sequence = { names: string[]; members: Set<string> };

function sequence(names: readonly string[] = []): Sequence {
  const members = new Set(names);
  return { names: [...members], members };
}
function append(target: Sequence, name: string) {
  if (!target.members.has(name)) {
    if (target.names.length !== target.members.size) values(target);
    target.members.add(name);
    target.names.push(name);
  }
}
function values(target: Sequence): string[] {
  if (target.names.length !== target.members.size)
    target.names = target.names.filter((name) => target.members.has(name));
  return target.names;
}
const within = (path: string, root: string) => path === root || path.startsWith(root + "/");

/** One mutable editor per burst: appends are constant time; disk state stays immutable. */
export class OrderEditor {
  private order: Order;
  private edited = new Map<string, Sequence>();
  private initialized = new Set<string>();
  private removed = new Map<string, Set<string>>();
  private deletes: string[] = [];
  rules: string[];
  constructor(order: Order, rules: string[]) {
    this.order = Object.assign(Object.create(null) as Order, order);
    this.rules = [...rules];
  }
  names(path: string): string[] | undefined {
    this.flushDeletes();
    const edited = this.edited.get(path);
    return edited ? values(edited) : this.order[path];
  }
  changed(path: string): boolean {
    return this.initialized.has(path);
  }
  private ensure(
    path: string,
    baseline?: string[],
    alias?: [string, string],
  ): Sequence | undefined {
    if (excluded(path, this.rules)) return;
    let target = this.edited.get(path);
    if (target) return target;
    if (!baseline && !Object.hasOwn(this.order, path)) return;
    target = sequence(this.order[path]);
    for (const name of this.initialized.has(path) ? [] : (baseline ?? [])) {
      if (this.removed.get(path)?.has(name)) continue;
      // Another device may already have applied this exact rename.
      if (alias && name === alias[0] && target.members.has(alias[1])) continue;
      append(target, name);
    }
    this.edited.set(path, target);
    this.initialized.add(path);
    return target;
  }
  private flushDeletes() {
    if (!this.deletes.length) return;
    for (const [path, target] of this.edited) this.order[path] = values(target);
    this.order = deleteOrders(this.order, this.deletes);
    for (const path of this.deletes) {
      const parent = parentPath(path);
      let names = this.removed.get(parent);
      if (!names) this.removed.set(parent, (names = new Set()));
      names.add(baseName(path));
    }
    for (const path of this.initialized) {
      if (this.deletes.some((root) => within(path, root))) this.initialized.delete(path);
    }
    this.edited.clear();
    this.deletes = [];
  }
  apply(change: StableChange) {
    if (change.kind === "rename" && change.from === change.to) return;
    if (change.kind === "delete") {
      this.deletes.push(change.path);
      return;
    }
    this.flushDeletes();
    if (change.kind === "create") {
      const target = this.ensure(parentPath(change.path), change.destination);
      if (target) append(target, baseName(change.path));
      this.removed.get(parentPath(change.path))?.delete(baseName(change.path));
      return;
    }
    const oldParent = parentPath(change.from),
      newParent = parentPath(change.to);
    const oldName = baseName(change.from),
      newName = baseName(change.to);
    const source = this.ensure(oldParent, change.source, [oldName, newName]);
    if (oldParent === newParent) {
      if (source) {
        if (source.members.has(oldName) && !source.members.has(newName)) {
          source.names[source.names.indexOf(oldName)] = newName;
          source.members.delete(oldName);
          source.members.add(newName);
        } else {
          if (oldName !== newName) source.members.delete(oldName);
          append(source, newName);
        }
      }
    } else {
      source?.members.delete(oldName);
      const destination = this.ensure(newParent, change.destination);
      if (destination) append(destination, newName);
    }
    // Folder renames carry cached descendant ordering without touching siblings.
    for (const path of Object.keys(this.order)) {
      if (!within(path, change.from)) continue;
      const renamed = change.to + path.slice(change.from.length);
      this.order[renamed] = this.order[path];
      delete this.order[path];
    }
    for (const [path, target] of [...this.edited]) {
      if (!within(path, change.from)) continue;
      this.edited.delete(path);
      this.edited.set(change.to + path.slice(change.from.length), target);
    }
    for (const path of [...this.initialized]) {
      if (!within(path, change.from)) continue;
      this.initialized.delete(path);
      this.initialized.add(change.to + path.slice(change.from.length));
    }
    this.rules = renameExclusions(this.rules, change.from, change.to);
  }
  result(): Order {
    this.flushDeletes();
    for (const [path, target] of this.edited) this.order[path] = [...values(target)];
    return this.order;
  }
}

/** Immutable pre-event baselines plus an immediate, unsaved ordering overlay. */
export class StableOrder {
  private baselines = new Map<string, Sequence>();
  private captured = new Map<string, string[] | undefined>();
  private editor?: OrderEditor;

  observe(path: string, names: string[], complete: boolean) {
    if (!complete || this.editor) return;
    const before = this.baselines.get(path);
    // A sorter can run after a path changed but before our vault event listener.
    // Never replace the old-name baseline with that already-mutated list.
    if (
      before &&
      (before.members.size !== names.length || names.some((name) => !before.members.has(name)))
    )
      return;
    this.baselines.set(path, sequence(names));
  }
  seedEmpty(path: string) {
    this.baselines.set(path, sequence());
  }
  has(path: string): boolean {
    return this.baselines.has(path);
  }
  names(path: string, saved?: string[]): string[] | undefined {
    return this.editor?.names(path) ?? saved;
  }
  rules(saved: string[]): string[] {
    return this.editor?.rules ?? saved;
  }
  private capture(path: string): string[] | undefined {
    if (!this.captured.has(path)) {
      const names = this.editor?.names(path);
      const baseline = this.baselines.get(path);
      // Keep synced ranks first, then the complete native baseline for partial orders.
      const combined = sequence(names);
      if (!this.editor?.changed(path)) {
        for (const name of baseline ? values(baseline) : []) append(combined, name);
      }
      this.captured.set(path, names || baseline ? [...values(combined)] : undefined);
    }
    return this.captured.get(path);
  }
  stage(change: FileChange, saved: Order, rules: string[]): StableChange {
    this.editor ??= new OrderEditor(saved, rules);
    let prepared: StableChange;
    if (change.kind === "rename") {
      prepared = {
        ...change,
        source: this.capture(parentPath(change.from)),
        destination: this.capture(parentPath(change.to)),
      };
    } else if (change.kind === "create") {
      // No prior baseline is needed for a newly created empty directory.
      prepared = { ...change, destination: this.capture(parentPath(change.path)) ?? [] };
    } else prepared = change;
    this.editor.apply(prepared);
    if (change.kind === "rename") this.followRename(change.from, change.to);
    if (change.kind === "delete") {
      this.baselines.get(parentPath(change.path))?.members.delete(baseName(change.path));
      for (const path of this.baselines.keys())
        if (within(path, change.path)) this.baselines.delete(path);
    }
    return prepared;
  }
  followRename(from: string, to: string) {
    for (const [path, baseline] of [...this.baselines]) {
      if (!within(path, from)) continue;
      this.baselines.delete(path);
      this.baselines.set(to + path.slice(from.length), baseline);
    }
  }
  afterMove(from: string, to: string, pending: StableChange[]): StableChange[] {
    this.followRename(from, to);
    let source = parentPath(from);
    const movedName = baseName(from);
    return pending.map((change) => {
      const next = { ...change };
      const sourceParent = change.kind === "rename" ? parentPath(change.from) : undefined;
      const destinationParent =
        change.kind === "create"
          ? parentPath(change.path)
          : change.kind === "rename"
            ? parentPath(change.to)
            : undefined;
      // A native create can arrive while an explicit cross-folder drop is saving.
      // Its pre-event baseline may still contain the file that just left.
      if (sourceParent === source && next.source)
        next.source = next.source.filter((name) => name !== movedName);
      if (destinationParent === source && next.destination)
        next.destination = next.destination.filter((name) => name !== movedName);
      if (change.kind === "rename" && within(source, change.from))
        source = change.to + source.slice(change.from.length);
      return next;
    });
  }
  afterRollback(from: string, to: string, pending: StableChange[]): StableChange[] {
    this.followRename(from, to);
    const relocated = (path: string) => (within(path, from) ? to + path.slice(from.length) : path);
    return pending.map((change) =>
      change.kind === "rename"
        ? { ...change, from: relocated(change.from), to: relocated(change.to) }
        : { ...change, path: relocated(change.path) },
    );
  }
  startBatch() {
    this.captured.clear();
  }
  rebase(saved: Order, pending: StableChange[], rules: string[]) {
    this.editor = undefined;
    this.captured.clear();
    if (pending.length) {
      this.editor = new OrderEditor(saved, rules);
      for (const change of pending) this.editor.apply(change);
    }
  }
  accept(saved: Order, pending: StableChange[], rules: string[], committed: StableChange[]) {
    const parents = new Set<string>();
    for (const change of committed) {
      if (change.kind === "rename") {
        for (const path of [...parents]) {
          if (!within(path, change.from)) continue;
          parents.delete(path);
          parents.add(change.to + path.slice(change.from.length));
        }
        parents.add(parentPath(change.from));
        parents.add(parentPath(change.to));
      } else if (change.kind === "create") parents.add(parentPath(change.path));
      else {
        for (const path of parents) if (within(path, change.path)) parents.delete(path);
        parents.add(parentPath(change.path));
      }
    }
    for (const path of parents) {
      if (saved[path] && !excluded(path, rules)) this.baselines.set(path, sequence(saved[path]));
      else this.forget(path);
    }
    // A newer folder event can arrive while this older batch is saving. Do not
    // leave a baseline under its previous path when publishing that older batch.
    for (const change of pending) {
      if (change.kind === "rename") this.followRename(change.from, change.to);
      else if (change.kind === "delete") {
        this.baselines.get(parentPath(change.path))?.members.delete(baseName(change.path));
        for (const path of this.baselines.keys())
          if (within(path, change.path)) this.baselines.delete(path);
      }
    }
    this.rebase(saved, pending, rules);
  }
  forget(path: string) {
    this.baselines.delete(path);
    this.captured.delete(path);
  }
}
