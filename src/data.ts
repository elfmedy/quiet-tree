import { parseOrder, relativePath, withoutExcluded, type Order } from "./order";
import { loadSettings, readSettings, type Settings } from "./settings-data";

/** Keep the entire ordering in one array-valued key for settings JSON sync. */
export type OrderState = [1, [string, string[]][]];
export const DATA_VERSION = 1;
export type PluginData = Settings & { dataVersion: typeof DATA_VERSION; orderState: OrderState };
export interface LegacyOrder {
  path: string;
  text: string;
}
export interface DataIO {
  load(): Promise<unknown>;
  loadRaw(): Promise<string | null>;
  save(data: PluginData): Promise<void>;
  loadLegacy(path: string): Promise<string | null>;
  backup(data: unknown, legacy?: LegacyOrder): Promise<void>;
}

export function canResetData(error: unknown): boolean {
  return (
    error instanceof Error &&
    ["invalidJson", "invalidLegacyOrder", "invalidPath"].includes(error.message)
  );
}

export function readOrderState(value: unknown): Order {
  if (Array.isArray(value) && Number.isInteger(value[0]) && value[0] > 1)
    throw new Error("newerDataVersion");
  if (!Array.isArray(value) || value.length !== 2 || value[0] !== 1 || !Array.isArray(value[1]))
    throw new Error("invalidJson");
  const order = Object.create(null) as Record<string, unknown>;
  for (const entry of value[1] as unknown[]) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      Object.hasOwn(order, entry[0])
    )
      throw new Error("invalidJson");
    order[entry[0]] = entry[1];
  }
  return parseOrder(JSON.stringify(order));
}

export class DataStore {
  order = Object.create(null) as Order;
  readonly settings: Settings;
  error: unknown = null;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private io: DataIO,
    private defaults: string[],
  ) {
    this.settings = loadSettings(null, defaults);
  }
  get rules(): string[] {
    return this.settings.excluded;
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const task = this.tail.then(async () => {
      try {
        const result = await action();
        this.error = null;
        return result;
      } catch (error) {
        this.error = error;
        throw error;
      }
    });
    this.tail = task.catch(() => {});
    return task;
  }
  private async read(): Promise<{ settings: Settings; order: Order }> {
    const raw = await this.io.load();
    if (raw === null || raw === undefined)
      return { settings: loadSettings(null, this.defaults), order: Object.create(null) as Order };
    const { settings, order, legacy, versioned } = await this.decode(raw);
    if (!versioned) await this.replace(raw, this.encode(settings, order), legacy);
    return { settings, order: withoutExcluded(order, settings.excluded) };
  }
  private async decode(raw: unknown) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalidJson");
    const data = raw as Record<string, unknown>;
    const versioned = Object.hasOwn(data, "dataVersion");
    if (versioned && data.dataVersion !== DATA_VERSION) {
      if (
        typeof data.dataVersion === "number" &&
        Number.isInteger(data.dataVersion) &&
        data.dataVersion > DATA_VERSION
      )
        throw new Error("newerDataVersion");
      throw new Error("invalidJson");
    }
    const settings = loadSettings(data, this.defaults);
    let order: Order;
    let legacy: LegacyOrder | undefined;
    if (!versioned && !Object.hasOwn(data, "orderState") && typeof data.jsonPath === "string") {
      const path = relativePath(data.jsonPath);
      if (!path.toLowerCase().endsWith(".json")) throw new Error("invalidPath");
      const text = await this.io.loadLegacy(path);
      // A missing file may still be syncing. Never replace it with an empty snapshot.
      if (text === null) throw new Error("missingLegacyOrder");
      try {
        order = parseOrder(text);
      } catch (error) {
        throw new Error("invalidLegacyOrder", { cause: error });
      }
      legacy = { path, text };
    } else {
      order = readOrderState(data.orderState);
    }
    return { settings, order, legacy, versioned };
  }
  private async replace(raw: unknown, data: PluginData, legacy?: LegacyOrder) {
    // Only validated upgrades or an explicitly confirmed reset reach this method.
    // The backup and save share the same queue as settings and sorting changes.
    try {
      await this.io.backup(raw, legacy);
    } catch (error) {
      throw new Error("migrationBackupFailed", { cause: error });
    }
    try {
      await this.io.save(data);
    } catch (error) {
      throw new Error("migrationSaveFailed", { cause: error });
    }
  }
  private encode(settings: Settings, order: Order): PluginData {
    return { dataVersion: DATA_VERSION, ...settings, orderState: [1, Object.entries(order)] };
  }
  load(): Promise<boolean> {
    return this.serial(async () => {
      const next = await this.read();
      const changed =
        JSON.stringify(this.encode(next.settings, next.order)) !==
        JSON.stringify(this.encode(this.settings, this.order));
      Object.assign(this.settings, next.settings);
      this.order = next.order;
      return changed;
    });
  }
  update(change: (order: Order, settings: Settings) => Order): Promise<void> {
    return this.serial(async () => {
      // Read the latest synced data inside the same queue as every local write.
      const current = await this.read();
      const before = JSON.stringify(this.encode(current.settings, current.order));
      const order = withoutExcluded(
        change(current.order, current.settings),
        current.settings.excluded,
      );
      const data = this.encode(current.settings, order);
      readOrderState(data.orderState);
      if (JSON.stringify(data) !== before) await this.io.save(data);
      // Publish only after a successful save; failed writes retain the last good state.
      Object.assign(this.settings, current.settings);
      this.order = order;
    });
  }
  saveSettings(patch: Partial<Settings>): Promise<void> {
    const changes = readSettings(patch);
    return this.update((order, settings) => {
      Object.assign(settings, changes);
      return order;
    });
  }
  resetInvalidData(): Promise<void> {
    return this.serial(async () => {
      const text = await this.io.loadRaw();
      if (text === null) throw new Error("dataChanged");
      let raw: unknown;
      try {
        raw = JSON.parse(text.replace(/^\uFEFF/, "")) as unknown;
      } catch {
        // Preserve the exact broken JSON in the backup; retain last-known settings.
      }
      if (raw !== undefined) {
        let invalid = false;
        try {
          await this.decode(raw);
        } catch (error) {
          if (!canResetData(error)) throw error;
          invalid = true;
        }
        // Sync or another action may have repaired the data while the dialog was open.
        if (!invalid) throw new Error("dataChanged");
      }
      let legacy: LegacyOrder | undefined;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const data = raw as Record<string, unknown>;
        if (
          !Object.hasOwn(data, "orderState") &&
          !Object.hasOwn(data, "dataVersion") &&
          typeof data.jsonPath === "string"
        ) {
          let path: string | undefined;
          try {
            path = relativePath(data.jsonPath);
          } catch {
            /* An invalid path cannot be read. */
          }
          if (path) {
            const oldText = await this.io.loadLegacy(path);
            if (oldText !== null) legacy = { path, text: oldText };
          }
        }
      }
      const settings = loadSettings({ ...this.settings, ...readSettings(raw) }, this.defaults);
      const order = Object.create(null) as Order;
      await this.replace(text, this.encode(settings, order), legacy);
      Object.assign(this.settings, settings);
      this.order = order;
    });
  }
  settled(): Promise<unknown> {
    return this.tail;
  }
}
