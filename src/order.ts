/** Portable order format: directory paths -> direct child names, in display order. */
export type Order = Record<string, string[]>;
export const parentPath = (path: string): string =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/";
export const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
export const childPath = (parent: string, name: string): string =>
  parent === "/" ? name : `${parent}/${name}`;
const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => character.charCodeAt(0) < 32);
export function relativePath(raw: string): string {
  const value = raw.trim().replace(/\\/g, "/");
  if (
    !value ||
    value.startsWith("/") ||
    value.includes(":") ||
    hasControlCharacter(value) ||
    value.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw new Error("invalidPath");
  return value;
}
export function orderPath(raw: string, configDir: string, pluginId: string): string {
  const value = relativePath(raw);
  const lower = value.toLowerCase();
  if (!lower.endsWith(".json")) throw new Error("invalidPath");
  // Never let the order editor overwrite Obsidian or another plugin's settings.
  if (lower.startsWith(configDir.toLowerCase() + "/")) {
    const home = `${configDir}/plugins/${pluginId}/`.toLowerCase();
    if (
      !lower.startsWith(home) ||
      ["data.json", "manifest.json", "package.json", "versions.json"].includes(
        lower.slice(home.length),
      )
    )
      throw new Error("reservedPath");
  }
  return value;
}
export function parseOrder(text: string): Order {
  const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalidJson");
  const result = Object.create(null) as Order;
  for (const [path, names] of Object.entries(value)) {
    if (path !== "/" && relativePath(path) !== path) throw new Error("invalidJson");
    if (!Array.isArray(names)) throw new Error("invalidJson");
    const entries: unknown[] = names;
    if (
      !entries.every(
        (name): name is string =>
          typeof name === "string" &&
          name.length > 0 &&
          name !== "." &&
          name !== ".." &&
          !name.includes("/") &&
          !name.includes("\\") &&
          !hasControlCharacter(name),
      ) ||
      new Set(entries).size !== entries.length
    )
      throw new Error("invalidJson");
    result[path] = entries;
  }
  return result;
}
export const stringifyOrder = (order: Order): string => JSON.stringify(order, null, 2) + "\n";
export function excluded(path: string, rules: string[]): boolean {
  return rules.some((rule) => path === rule || path.startsWith(rule + "/"));
}
export function renameExclusions(rules: string[], oldPath: string, newPath: string): string[] {
  return rules.map((rule) =>
    rule === oldPath || rule.startsWith(oldPath + "/")
      ? newPath + rule.slice(oldPath.length)
      : rule,
  );
}
export function parseExclusions(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(relativePath),
    ),
  ];
}
export function attachmentExclusion(config: string | undefined): string[] {
  // Obsidian's current-folder and per-note relative modes are not one vault path.
  if (!config || config === "/" || config === "." || config.startsWith("./")) return [];
  try {
    return [relativePath(config)];
  } catch {
    return [];
  }
}
export function withoutExcluded(order: Order, rules: string[]): Order {
  return Object.assign(
    Object.create(null) as Order,
    Object.fromEntries(Object.entries(order).filter(([path]) => !excluded(path, rules))),
  );
}
export function sortItems<T>(
  items: T[],
  names: string[] | undefined,
  getName: (item: T) => string,
): T[] {
  if (!names?.length) return items;
  const rank = new Map(names.map((name, i) => [name, i]));
  return items
    .map((item, index) => ({
      item,
      index,
      rank: rank.get(getName(item)) ?? Infinity,
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item);
}
export function renameOrder(order: Order, oldPath: string, newPath: string): Order {
  const next = Object.create(null) as Order;
  const oldParent = parentPath(oldPath),
    newParent = parentPath(newPath);
  for (const [key, names] of Object.entries(order)) {
    const path =
      key === oldPath || key.startsWith(oldPath + "/") ? newPath + key.slice(oldPath.length) : key;
    let updated = [...names];
    if (key === oldParent)
      updated =
        oldParent === newParent
          ? updated.map((n) => (n === baseName(oldPath) ? baseName(newPath) : n))
          : updated.filter((n) => n !== baseName(oldPath));
    if (
      key === newParent &&
      oldParent !== newParent &&
      order[oldParent]?.includes(baseName(oldPath)) &&
      !updated.includes(baseName(newPath))
    )
      updated.push(baseName(newPath));
    next[path] = [...new Set(updated)];
  }
  return next;
}
export function deleteOrder(order: Order, path: string): Order {
  const next = Object.create(null) as Order;
  for (const [key, names] of Object.entries(order)) {
    if (key === path || key.startsWith(path + "/")) continue;
    next[key] = key === parentPath(path) ? names.filter((n) => n !== baseName(path)) : [...names];
  }
  return next;
}
export interface OrderAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  process(path: string, fn: (text: string) => string): Promise<string>;
}
export class OrderStore {
  order = Object.create(null) as Order;
  error: unknown = null;
  private tail: Promise<unknown> = Promise.resolve();
  private lastText = "";
  constructor(
    readonly adapter: OrderAdapter,
    public path: string,
    public rules: string[],
  ) {}
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const task = this.tail.then(action);
    this.tail = task.catch(() => {});
    return task;
  }
  private async create(path: string, order: Order): Promise<void> {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const directory = parts.slice(0, i).join("/");
      if (!(await this.adapter.exists(directory))) await this.adapter.mkdir(directory);
    }
    if (!(await this.adapter.exists(path))) await this.adapter.write(path, stringifyOrder(order));
  }
  async load(): Promise<boolean> {
    return this.serial(async () => {
      try {
        await this.create(this.path, this.order);
        const text = await this.adapter.read(this.path);
        const changed = text !== this.lastText;
        const parsed = withoutExcluded(parseOrder(text), this.rules);
        this.order = parsed;
        this.lastText = text;
        this.error = null;
        return changed;
      } catch (error) {
        this.error = error;
        throw error;
      }
    });
  }
  async update(change: (current: Order) => Order): Promise<void> {
    return this.serial(async () => {
      try {
        const text = await this.adapter.process(this.path, (current) =>
          stringifyOrder(withoutExcluded(change(parseOrder(current)), this.rules)),
        );
        this.order = withoutExcluded(parseOrder(text), this.rules);
        this.lastText = text;
        this.error = null;
      } catch (error) {
        this.error = error;
        throw error;
      }
    });
  }
  async switchPath(path: string): Promise<void> {
    return this.serial(async () => {
      // Existing files win; new paths receive a copy. The old file stays available.
      await this.create(path, this.order);
      const text = await this.adapter.read(path);
      const order = withoutExcluded(parseOrder(text), this.rules);
      this.path = path;
      this.order = order;
      this.lastText = text;
      this.error = null;
    });
  }
  settled(): Promise<unknown> {
    return this.tail;
  }
}
