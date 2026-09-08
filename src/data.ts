import { parseOrder, withoutExcluded, type Order } from "./order";
import { loadSettings, readSettings, type Settings } from "./settings-data";

/** Keep the entire ordering in one array-valued key for settings JSON sync. */
export type OrderState = [1, [string, string[]][]];
export type PluginData = Settings & { orderState: OrderState };
export interface DataIO {
  load(): Promise<unknown>;
  save(data: PluginData): Promise<void>;
}

export function readOrderState(value: unknown): Order {
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
    if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalidJson");
    const settings = loadSettings(raw, this.defaults);
    const order = readOrderState((raw as Record<string, unknown>).orderState);
    return { settings, order: withoutExcluded(order, settings.excluded) };
  }
  private encode(settings: Settings, order: Order): PluginData {
    return { ...settings, orderState: [1, Object.entries(order)] };
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
  settled(): Promise<unknown> {
    return this.tail;
  }
}
