import {
  FuzzySuggestModal,
  PluginSettingTab,
  Setting,
  Notice,
  TFolder,
  setIcon,
  type App,
} from "obsidian";
import type QuietTreePlugin from "./main";
import { orderPath, parseExclusions } from "./order";
import type { TextKey } from "./i18n";

class FolderPicker extends FuzzySuggestModal<TFolder> {
  constructor(
    app: App,
    private choose: (path: string) => void,
    placeholder: string,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getItems(): TFolder[] {
    const folders: TFolder[] = [];
    const visit = (parent: TFolder) => {
      for (const child of parent.children) {
        if (child instanceof TFolder) {
          folders.push(child);
          visit(child);
        }
      }
    };
    visit(this.app.vault.getRoot());
    return folders;
  }
  getItemText(folder: TFolder): string {
    return folder.path;
  }
  onChooseItem(folder: TFolder): void {
    this.choose(folder.path);
  }
}

export class ExplorerSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: QuietTreePlugin,
  ) {
    super(app, plugin);
  }
  private section(name: TextKey, help?: TextKey): HTMLElement {
    const section = this.containerEl.createDiv({ cls: "qt-section" });
    const header = section.createDiv({ cls: "qt-section-header" });
    new Setting(header).setName(this.plugin.t(name)).setHeading();
    if (help) {
      const explanation = section.createEl("ul", {
        cls: "qt-help",
      });
      for (const text of this.plugin.t(help).split("\n")) explanation.createEl("li", { text });
      explanation.hidden = true;
      const button = header.createEl("button", {
        cls: "clickable-icon qt-help-toggle",
        attr: {
          "aria-label": this.plugin.t("details"),
          "aria-expanded": "false",
        },
      });
      setIcon(button, "info");
      button.addEventListener("click", () => {
        explanation.hidden = !explanation.hidden;
        button.setAttribute("aria-expanded", String(!explanation.hidden));
      });
    }
    return section;
  }
  private async exclusions(next: string[]): Promise<void> {
    const p = this.plugin,
      previous = p.store.rules;
    p.cancelDrags();
    p.store.rules = next;
    try {
      await p.store.update((order) => order);
      p.settings.excluded = next;
      await p.saveSettings();
      p.refresh();
      this.renderSettings();
    } catch (error) {
      p.store.rules = previous;
      p.report(error);
    }
  }
  display() {
    this.renderSettings();
  }
  private renderSettings() {
    const { containerEl } = this,
      p = this.plugin,
      t = p.t;
    containerEl.empty();
    containerEl.addClass("qt-settings");
    const interaction = this.section("interaction", "interactionHelp");
    new Setting(interaction).setName(t("trigger")).addDropdown((dropdown) =>
      dropdown
        .addOptions({ row: t("row"), handle: t("handle") })
        .setValue(p.settings.trigger)
        .onChange(async (value) => {
          p.settings.trigger = value as "row" | "handle";
          await p.saveSettings();
          p.refresh();
        }),
    );
    new Setting(interaction).setName(t("delay")).addSlider((slider) =>
      slider
        .setLimits(180, 800, 10)
        .setValue(p.settings.delay)
        .onChange(async (value) => {
          p.settings.delay = value;
          await p.saveSettings();
        }),
    );
    const storage = this.section("path", "pathHelp");
    let path = p.settings.jsonPath;
    const pathField = new Setting(storage)
      .setClass("qt-path-field")
      .addText((text) => {
        text
          .setValue(path)
          .setPlaceholder(p.defaultPath())
          .onChange((value) => {
            path = value;
          });
        text.inputEl.setAttribute("aria-label", t("path"));
        text.inputEl.title = path;
      })
      .addButton((button) =>
        button.setButtonText(t("apply")).onClick(async () => {
          button.setDisabled(true);
          try {
            const next = orderPath(path, p.app.vault.configDir, p.manifest.id);
            p.cancelDrags();
            await p.store.switchPath(next);
            p.settings.jsonPath = next;
            await p.saveSettings();
            p.refresh();
            new Notice(t("saved"));
            this.renderSettings();
          } catch (error) {
            p.report(error);
          } finally {
            button.setDisabled(false);
          }
        }),
      );
    pathField.infoEl.remove();
    const excluded = this.section("exclusions", "exclusionsHelp");
    const list = excluded.createDiv({ cls: "qt-exclusion-list" });
    if (!p.settings.excluded.length)
      list.createEl("p", { cls: "qt-empty", text: t("noExclusions") });
    for (const path of p.settings.excluded) {
      const row = list.createDiv({ cls: "qt-exclusion-row" });
      setIcon(row.createSpan({ cls: "qt-folder-icon" }), "folder");
      row.createSpan({
        text: path,
        cls: "qt-folder-path",
        attr: { title: path },
      });
      const remove = row.createEl("button", {
        cls: "clickable-icon",
        attr: { "aria-label": `${t("remove")}: ${path}` },
      });
      setIcon(remove, "x");
      remove.addEventListener("click", () => {
        remove.disabled = true;
        void this.exclusions(p.settings.excluded.filter((item) => item !== path)).finally(() => {
          remove.disabled = false;
        });
      });
    }
    const add = excluded.createDiv({ cls: "qt-add-directory" });
    const input = add.createEl("input", {
      type: "text",
      placeholder: t("directoryPlaceholder"),
      attr: { "aria-label": t("addDirectory") },
    });
    const browse = add.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": t("chooseDirectory") },
    });
    setIcon(browse, "folder-search");
    browse.addEventListener("click", () =>
      new FolderPicker(
        this.app,
        (path) => {
          input.value = path;
          input.focus();
        },
        t("chooseDirectory"),
      ).open(),
    );
    const submit = add.createEl("button", { text: t("add") });
    const commit = async () => {
      submit.disabled = true;
      try {
        const paths = parseExclusions(input.value);
        if (paths.length) await this.exclusions([...new Set([...p.settings.excluded, ...paths])]);
      } catch (error) {
        p.report(error);
      } finally {
        submit.disabled = false;
      }
    };
    submit.addEventListener("click", () => void commit());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void commit();
      }
    });
    const attachment = excluded.createEl("button", {
      cls: "qt-text-button",
      text: t("attachment"),
    });
    attachment.addEventListener("click", () => {
      const paths = p.attachmentRules();
      if (!paths.length) {
        new Notice(t("noAttachment"));
        return;
      }
      attachment.disabled = true;
      void this.exclusions([...new Set([...p.settings.excluded, ...paths])]).finally(() => {
        attachment.disabled = false;
      });
    });
    const general = this.section("general");
    containerEl.prepend(general);
    new Setting(general).setName(t("language")).addDropdown((dropdown) =>
      dropdown
        .addOptions({ auto: t("auto"), zh: "中文", en: "English" })
        .setValue(p.settings.language)
        .onChange(async (value) => {
          p.settings.language = value as "auto" | "zh" | "en";
          await p.saveSettings();
          p.refresh();
          this.renderSettings();
        }),
    );
    if (p.store.error) containerEl.createEl("p", { text: t("readError"), cls: "qt-error" });
  }
}
