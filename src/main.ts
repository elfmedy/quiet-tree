import {
  getLanguage,
  Notice,
  Plugin,
  TFolder,
  type TAbstractFile,
  type WorkspaceLeaf,
  type App,
} from "obsidian";
import type { DropTarget } from "../lib/explorer-model";
import { attachSort, compatibleExplorer, type NativeExplorer } from "./native";
import { DragController } from "./drag";
import {
  attachmentExclusion,
  baseName,
  childPath,
  excluded,
  renameExclusions,
  renameOrder,
  sortItems,
  parentPath,
} from "./order";
import { translate, type TextKey } from "./i18n";
import { ExplorerSettingsTab } from "./settings";
import type { Settings } from "./settings-data";
import { DataStore } from "./data";
import { OrderEditor, StableOrder, type FileChange, type StableChange } from "./stable-order";

// Obsidian does not await onunload(). Coordinate only this plugin's asynchronous
// final save with a replacement instance in the same app; never persist app data.
const flushHandoff = Symbol.for("quiet-tree.flush-handoff");
type Handoff = { task: Promise<void>; remaining: StableChange[] };
type CoordinatedApp = App & { [flushHandoff]?: Handoff };

export default class QuietTreePlugin extends Plugin {
  store!: DataStore;
  declare settings: Settings;
  private settingsTab!: ExplorerSettingsTab;
  private views = new Map<
    NativeExplorer,
    { drag: DragController; restore: () => void; root: HTMLElement }
  >();
  private ownRenames = new Map<string, string>();
  private busy = false;
  private moving?: Promise<void>;
  private refreshTimer = 0;
  private changeTimer = 0;
  private changes: StableChange[] = [];
  private stable = new StableOrder();
  private flushing: Promise<void> | null = null;
  private alive = false;
  private baselinesReady = false;
  private loadingLeaves = new WeakSet<WorkspaceLeaf>();
  private warnedViews = new WeakSet<object>();
  t = (key: TextKey): string =>
    translate(this.settings.language === "auto" ? getLanguage() : this.settings.language, key);

  attachmentRules(): string[] {
    const vault = this.app.vault as typeof this.app.vault & {
      getConfig(key: string): unknown;
    };
    return attachmentExclusion(vault.getConfig("attachmentFolderPath") as string | undefined);
  }
  async onload() {
    const coordinator = this.app as CoordinatedApp;
    const handoff = coordinator[flushHandoff];
    if (handoff) {
      await handoff.task.catch(() => {});
      if (coordinator[flushHandoff] === handoff) delete coordinator[flushHandoff];
      this.changes = handoff.remaining;
    }
    this.store = new DataStore(
      {
        load: async () => {
          const data: unknown = await this.loadData();
          // Obsidian can return null for unreadable JSON. Never treat that as a new install.
          if (
            data == null &&
            (await this.app.vault.adapter.exists(this.manifest.dir + "/data.json"))
          )
            throw new Error("invalidJson");
          return data;
        },
        save: (data) => this.saveData(data),
        loadRaw: async () => {
          const adapter = this.app.vault.adapter;
          const path = this.manifest.dir + "/data.json";
          return (await adapter.exists(path)) ? adapter.read(path) : null;
        },
        loadLegacy: async (path) => {
          const adapter = this.app.vault.adapter;
          return (await adapter.exists(path)) ? adapter.read(path) : null;
        },
        backup: async (data, legacy) => {
          const adapter = this.app.vault.adapter;
          const root = this.manifest.dir + "/backups";
          if (!(await adapter.exists(root))) await adapter.mkdir(root);
          const base = root + "/data-v1-" + Date.now();
          let path = base;
          for (let suffix = 1; await adapter.exists(path); suffix++) path = base + "-" + suffix;
          await adapter.mkdir(path);
          await adapter.write(
            path + "/data.json",
            typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n",
          );
          if (legacy) await adapter.write(path + "/sort-order.json", legacy.text);
        },
      },
      this.attachmentRules(),
    );
    this.settings = this.store.settings;
    try {
      await this.store.load();
    } catch (error) {
      this.report(error, "readError");
    }
    this.stable.rebase(this.store.order, this.changes, this.store.rules);
    this.alive = true;
    this.settingsTab = new ExplorerSettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);
    this.addCommand({
      id: "reload-order",
      name: this.t("reload"),
      callback: () => void this.reload(true),
    });
    this.addCommand({
      id: "reset-root-order",
      name: `${this.t("reset")} — ${this.t("root")}`,
      callback: () => void this.resetFolder("/"),
    });
    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncViews()));
    this.app.workspace.onLayoutReady(() => {
      if (this.alive) this.syncViews();
    });
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.cancelDrags();
        if (this.ownRenames.get(oldPath) === file.path) return;
        this.queueChange({ kind: "rename", from: oldPath, to: file.path });
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.cancelDrags();
        this.queueChange({ kind: "delete", path: file.path });
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        this.cancelDrags();
        if (!this.alive || !this.app.workspace.layoutReady || !this.baselinesReady) return;
        if (file instanceof TFolder) this.stable.seedEmpty(file.path);
        this.queueChange({ kind: "create", path: file.path });
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        const path = file instanceof TFolder ? file.path : (file.parent?.path ?? "/");
        if (!excluded(path, this.settings.excluded))
          menu.addItem((item) =>
            item
              .setTitle(this.t("reset"))
              .setIcon("list-restart")
              .onClick(() => this.resetFolder(path)),
          );
      }),
    );
    this.registerInterval(window.setInterval(() => this.syncViews(), 2000));
    if (this.changes.length) this.scheduleChanges();
  }
  onunload() {
    this.alive = false;
    window.clearTimeout(this.refreshTimer);
    window.clearTimeout(this.changeTimer);
    const handoff: Handoff = { task: Promise.resolve(), remaining: [] };
    handoff.task = this.flushChanges().finally(() => {
      handoff.remaining = [...this.changes];
    });
    (this.app as CoordinatedApp)[flushHandoff] = handoff;
    void handoff.task.catch((error) => this.report(error, "savePending"));
    for (const binding of this.views.values()) {
      binding.drag.destroy();
      binding.restore();
    }
    this.views.clear();
  }
  report(error: unknown, fallback: TextKey = "error") {
    console.error("[Quiet Tree]", error);
    new Notice(this.errorText(error, fallback), 7000);
    this.settingsTab?.refreshSettings();
  }
  errorText(error: unknown, fallback: TextKey = "readError"): string {
    const key = error instanceof Error ? error.message : "";
    const known: TextKey[] = [
      "invalidPath",
      "invalidJson",
      "newerDataVersion",
      "missingLegacyOrder",
      "invalidLegacyOrder",
      "migrationBackupFailed",
      "migrationSaveFailed",
      "dataChanged",
      "collision",
      "locked",
      "changed",
      "rollbackFailed",
    ];
    return this.t(known.includes(key as TextKey) ? (key as TextKey) : fallback);
  }
  async saveSettings(patch: Partial<Settings>) {
    await this.flushChanges();
    await this.store.saveSettings(patch);
    this.stable.rebase(this.store.order, this.changes, this.store.rules);
    this.seedBaselines();
    this.refresh();
  }
  private queueChange(change: FileChange) {
    // A newly loaded/created parent may not have been sorted by the native view yet.
    const parent = parentPath(change.kind === "rename" ? change.to : change.path);
    if (!this.stable.has(parent) && change.kind !== "delete") this.seedBaselines(parent);
    this.changes.push(this.stable.stage(change, this.store.order, this.store.rules));
    this.scheduleChanges();
  }
  private scheduleChanges() {
    if (!this.changeTimer)
      this.changeTimer = window.setTimeout(() => {
        this.changeTimer = 0;
        void this.flushChanges().catch((error) => this.report(error, "savePending"));
      }, 100);
  }
  async flushChanges(): Promise<void> {
    if (this.moving) await this.moving;
    window.clearTimeout(this.changeTimer);
    this.changeTimer = 0;
    if (this.flushing) return this.flushing;
    this.flushing = this.applyChanges();
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }
  private async applyChanges() {
    while (this.changes.length) {
      const batch = this.changes.splice(0);
      this.stable.startBatch();
      try {
        await this.store.update((order, settings) => {
          const editor = new OrderEditor(order, settings.excluded);
          for (const change of batch) editor.apply(change);
          settings.excluded = editor.rules;
          return editor.result();
        });
      } catch (error) {
        // Keep both the event journal and its visible overlay for an explicit retry.
        this.changes = [...batch, ...this.changes];
        throw error;
      }
      this.stable.accept(this.store.order, this.changes, this.store.rules, batch);
      this.refresh();
    }
  }
  async onExternalSettingsChange() {
    this.cancelDrags();
    await this.reload(false, true);
  }
  cancelDrags() {
    for (const { drag } of this.views.values()) drag.cancel();
  }
  refresh() {
    if (!this.alive) return;
    this.cancelDrags();
    if (this.refreshTimer) return;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = 0;
      if (!this.alive) return;
      for (const [view, { drag }] of this.views) {
        try {
          view.requestSort();
          drag.decorate();
        } catch (error) {
          this.viewError(view, error);
        }
      }
    }, 0);
  }
  private viewError(view: object, error: unknown) {
    console.error("[Quiet Tree] native explorer compatibility", error);
    this.views.get(view as NativeExplorer)?.drag.cancel();
    if (!this.warnedViews.has(view)) {
      this.warnedViews.add(view);
      new Notice(this.t("compatibilityError"), 7000);
    }
  }
  private syncViews() {
    if (!this.alive || !this.app.workspace.layoutReady) return;
    const leaves = this.app.workspace.getLeavesOfType("file-explorer");
    for (const leaf of leaves) {
      // Mobile sidebars are commonly deferred at startup. A placeholder view
      // does not expose explorer methods and must never be reported as incompatible.
      if (leaf.isDeferred && !this.loadingLeaves.has(leaf)) {
        this.loadingLeaves.add(leaf);
        void leaf
          .loadIfDeferred()
          .then(() => {
            this.loadingLeaves.delete(leaf);
            if (!leaf.isDeferred) this.syncViews();
          })
          .catch((error: unknown) => {
            this.loadingLeaves.delete(leaf);
            if (this.alive) console.error("[Quiet Tree] Could not load file explorer", error);
          });
      }
    }
    const current = new Set(
      leaves
        .filter((leaf) => !leaf.isDeferred)
        .map((leaf) => leaf.view as unknown as NativeExplorer),
    );
    for (const [view, binding] of this.views)
      if (!current.has(view) || binding.root !== view.navFileContainerEl) {
        binding.drag.destroy();
        binding.restore();
        this.views.delete(view);
      }
    for (const view of current) {
      if (this.views.has(view)) continue;
      if (!compatibleExplorer(view)) {
        this.viewError(view, new Error("unavailable"));
        continue;
      }
      let restore: (() => void) | undefined;
      try {
        restore = attachSort(view, this.store, (error) => this.viewError(view, error), this.stable);
        this.views.set(view, {
          restore,
          drag: new DragController(this, view),
          root: view.navFileContainerEl,
        });
        this.seedBaselines();
        this.baselinesReady = true;
      } catch (error) {
        restore?.();
        this.viewError(view, error);
      }
    }
  }
  private seedBaselines(path?: string) {
    const view = this.views.keys().next().value;
    if (!view) return;
    const root = path ? this.app.vault.getAbstractFileByPath(path) : this.app.vault.getRoot();
    if (!(root instanceof TFolder)) return;
    const folders = [root];
    while (folders.length) {
      const folder = folders.pop()!;
      if (excluded(folder.path, this.stable.rules(this.store.rules))) continue;
      if (!this.stable.has(folder.path)) {
        try {
          view.getSortedFolderItems(folder);
        } catch (error) {
          this.viewError(view, error);
        }
      }
      if (!path)
        for (const child of folder.children) if (child instanceof TFolder) folders.push(child);
    }
  }
  async reload(notify = false, external = false) {
    if (!this.alive) return;
    const hadError = !!this.store.error;
    try {
      if (!external) await this.flushChanges();
      this.syncViews();
      const changed = await this.store.load();
      this.stable.rebase(this.store.order, this.changes, this.store.rules);
      if (changed || hadError) {
        this.refresh();
        this.settingsTab.refreshSettings();
      }
      if (external && this.changes.length) await this.flushChanges();
      if (notify) new Notice(this.t("ready"));
    } catch (error) {
      if (notify || !hadError) this.report(error, "readError");
      this.settingsTab.refreshSettings();
    }
  }
  async resetFolder(path: string) {
    try {
      await this.flushChanges();
      await this.store.update((order) => {
        delete order[path];
        return order;
      });
      this.stable.forget(path);
      this.stable.rebase(this.store.order, this.changes, this.store.rules);
      this.seedBaselines(path);
      this.refresh();
      new Notice(this.t("resetDone"));
    } catch (error) {
      this.report(error);
    }
  }
  async resetInvalidData() {
    window.clearTimeout(this.changeTimer);
    this.changeTimer = 0;
    if (this.flushing) await this.flushing.catch(() => {});
    await this.store.resetInvalidData();
    this.changes = [];
    this.stable = new StableOrder();
    // Existing native wrappers hold the same StableOrder instance; rebind them.
    for (const binding of this.views.values()) {
      binding.drag.destroy();
      binding.restore();
    }
    this.views.clear();
    this.syncViews();
    this.refresh();
  }
  /** Filesystem moves go through FileManager so Obsidian can update links. */
  async move(view: NativeExplorer, path: string, target: DropTarget): Promise<void> {
    this.syncViews();
    if (this.busy || !this.alive) return;
    try {
      await this.flushChanges();
    } catch (error) {
      this.report(error);
      return;
    }
    if (this.busy || !this.alive) return;
    this.busy = true;
    let finishMove!: () => void;
    this.moving = new Promise((resolve) => {
      finishMove = resolve;
    });
    let movedFile: TAbstractFile | null = null;
    let originalPath = "";
    try {
      await this.store.load(); // Validate the file before changing any vault path.
      this.stable.rebase(this.store.order, this.changes, this.store.rules);
      const file = this.app.vault.getAbstractFileByPath(path);
      const destination = target.parentId ?? "/";
      const folder = this.app.vault.getAbstractFileByPath(destination);
      if (!file || !(folder instanceof TFolder)) throw new Error("changed");
      const source = file.parent?.path ?? "/";
      if (excluded(source, this.settings.excluded) || excluded(destination, this.settings.excluded))
        throw new Error("locked");
      if (destination === path || destination.startsWith(path + "/")) throw new Error("changed");
      if (target.beforeId === path) return;
      if (
        target.beforeId &&
        this.app.vault.getAbstractFileByPath(target.beforeId)?.parent !== folder
      )
        throw new Error("changed");
      const names = view
        .getSortedFolderItems(folder)
        .map((item) => item.file.name)
        .filter((name) => source !== destination || name !== file.name);
      const nextPath = childPath(destination, file.name);
      if (source !== destination) {
        if (
          this.app.vault.getAbstractFileByPath(nextPath) ||
          (await this.app.vault.adapter.exists(nextPath))
        )
          throw new Error("collision");
        originalPath = path;
        this.ownRenames.set(path, nextPath);
        try {
          await this.app.fileManager.renameFile(file, nextPath);
          movedFile = file;
        } finally {
          this.ownRenames.delete(path);
        }
      }
      await this.store.update((order, settings) => {
        if (source !== destination) {
          order = renameOrder(order, path, nextPath);
          settings.excluded = renameExclusions(settings.excluded, path, nextPath);
        }
        const ordered = sortItems(names, order[destination], (name) => name);
        const before = target.beforeId ? baseName(target.beforeId) : null;
        const index = before === null ? ordered.length : ordered.indexOf(before);
        if (index < 0) throw new Error("changed");
        ordered.splice(index, 0, file.name);
        order[destination] = ordered;
        return order;
      });
      if (source !== destination)
        this.changes = this.stable.afterMove(path, nextPath, this.changes);
      this.stable.forget(source);
      this.stable.forget(destination);
      this.stable.rebase(this.store.order, this.changes, this.store.rules);
      this.refresh();
      new Notice(this.t("moved"), 1500);
    } catch (error) {
      let failure = error;
      if (movedFile) {
        const from = movedFile.path;
        this.ownRenames.set(from, originalPath);
        try {
          await this.app.fileManager.renameFile(movedFile, originalPath);
          this.changes = this.stable.afterRollback(from, originalPath, this.changes);
          this.stable.rebase(this.store.order, this.changes, this.store.rules);
        } catch (rollbackError) {
          console.error("[Quiet Tree] rollback", rollbackError);
          failure = new Error("rollbackFailed");
        } finally {
          this.ownRenames.delete(from);
        }
      }
      this.report(failure);
      this.refresh();
    } finally {
      this.busy = false;
      this.moving = undefined;
      finishMove();
    }
  }
}
