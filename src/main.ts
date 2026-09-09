import {
  getLanguage,
  Notice,
  Plugin,
  TFolder,
  type TAbstractFile,
  type WorkspaceLeaf,
} from "obsidian";
import type { DropTarget } from "../lib/explorer-model";
import { attachSort, type NativeExplorer } from "./native";
import { DragController } from "./drag";
import {
  attachmentExclusion,
  baseName,
  childPath,
  deleteOrder,
  excluded,
  renameExclusions,
  renameOrder,
  sortItems,
} from "./order";
import { translate, type TextKey } from "./i18n";
import { ExplorerSettingsTab } from "./settings";
import type { Settings } from "./settings-data";
import { DataStore } from "./data";

export default class QuietTreePlugin extends Plugin {
  store!: DataStore;
  declare settings: Settings;
  private settingsTab!: ExplorerSettingsTab;
  private views = new Map<NativeExplorer, { drag: DragController; restore: () => void }>();
  private ownRenames = new Map<string, string>();
  private busy = false;
  private alive = false;
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
        void this.followRename(oldPath, file.path).catch((error) => this.report(error));
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.cancelDrags();
        void this.store
          .update((order) => deleteOrder(order, file.path))
          .then(() => this.refresh())
          .catch((error) => this.report(error));
      }),
    );
    this.registerEvent(this.app.vault.on("create", () => this.cancelDrags()));
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
  }
  onunload() {
    this.alive = false;
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
    await this.store.saveSettings(patch);
    this.refresh();
  }
  private async followRename(oldPath: string, newPath: string) {
    await this.store.update((order, settings) => {
      settings.excluded = renameExclusions(settings.excluded, oldPath, newPath);
      return renameOrder(order, oldPath, newPath);
    });
    this.refresh();
  }
  async onExternalSettingsChange() {
    this.cancelDrags();
    await this.reload();
  }
  cancelDrags() {
    for (const { drag } of this.views.values()) drag.cancel();
  }
  refresh() {
    if (!this.alive) return;
    this.cancelDrags();
    for (const [view, { drag }] of this.views) {
      view.requestSort();
      drag.decorate();
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
      if (!current.has(view)) {
        binding.drag.destroy();
        binding.restore();
        this.views.delete(view);
      }
    for (const view of current) {
      if (this.views.has(view)) continue;
      if (
        typeof view.getSortedFolderItems !== "function" ||
        typeof view.requestSort !== "function" ||
        !view.navFileContainerEl ||
        !view.fileItems
      ) {
        if (!this.warnedViews.has(view)) {
          this.warnedViews.add(view);
          new Notice(this.t("unavailable"));
        }
        continue;
      }
      const restore = attachSort(view, this.store);
      this.views.set(view, { restore, drag: new DragController(this, view) });
    }
  }
  async reload(notify = false) {
    if (!this.alive) return;
    const hadError = !!this.store.error;
    try {
      this.syncViews();
      const changed = await this.store.load();
      if (changed || hadError) {
        this.refresh();
        this.settingsTab.refreshSettings();
      }
      if (notify) new Notice(this.t("ready"));
    } catch (error) {
      if (notify || !hadError) this.report(error, "readError");
      this.settingsTab.refreshSettings();
    }
  }
  async resetFolder(path: string) {
    try {
      await this.store.update((order) => {
        delete order[path];
        return order;
      });
      this.refresh();
      new Notice(this.t("resetDone"));
    } catch (error) {
      this.report(error);
    }
  }
  /** Filesystem moves go through FileManager so Obsidian can update links. */
  async move(view: NativeExplorer, path: string, target: DropTarget): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    let movedFile: TAbstractFile | null = null;
    let originalPath = "";
    try {
      await this.store.load(); // Validate the file before changing any vault path.
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
      this.refresh();
      new Notice(this.t("moved"), 1500);
    } catch (error) {
      let failure = error;
      if (movedFile) {
        const from = movedFile.path;
        this.ownRenames.set(from, originalPath);
        try {
          await this.app.fileManager.renameFile(movedFile, originalPath);
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
    }
  }
}
