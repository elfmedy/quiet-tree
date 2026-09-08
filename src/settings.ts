import {
  FuzzySuggestModal,
  PluginSettingTab,
  Platform,
  Setting,
  Notice,
  TFolder,
  setIcon,
  requireApiVersion,
  type App,
  type SettingDefinitionItem,
} from "obsidian";
import type QuietTreePlugin from "./main";
import { parseExclusions } from "./order";

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
      for (const child of parent.children)
        if (child instanceof TFolder) {
          folders.push(child);
          visit(child);
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

interface Row {
  name: string;
  desc?: string;
  aliases?: string[];
  render: (setting: Setting) => void;
}
interface Group {
  heading: string;
  items: Row[];
}

export class ExplorerSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: QuietTreePlugin,
  ) {
    super(app, plugin);
  }

  // Share definitions with the fallback renderer for Obsidian before 1.13.
  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.groups().map((group) => ({
      type: "group",
      cls: "qt-settings qt-section",
      ...group,
    }));
  }
  display() {
    this.renderLegacy();
  }
  private renderLegacy() {
    this.containerEl.empty();
    this.containerEl.addClass("qt-settings");
    for (const group of this.groups()) {
      const section = this.containerEl.createDiv({ cls: "qt-section" });
      new Setting(section).setName(group.heading).setHeading();
      for (const row of group.items) {
        const setting = new Setting(section).setName(row.name);
        if (row.desc) setting.setDesc(row.desc);
        row.render(setting);
      }
    }
  }
  refreshSettings() {
    if (!this.containerEl.isConnected) return;
    if (requireApiVersion("1.13.0")) this.update();
    else this.renderLegacy();
  }
  private groups(): Group[] {
    const p = this.plugin,
      t = p.t;
    const key = Platform.isMobile ? "delay" : "mouseDelay";
    const groups: Group[] = [
      {
        heading: t("general"),
        items: [
          {
            name: t("language"),
            aliases: ["language", "语言"],
            render: (setting) => {
              setting.addDropdown((dropdown) =>
                dropdown
                  .addOptions({ auto: t("auto"), zh: "中文", en: "English" })
                  .setValue(p.settings.language)
                  .onChange(async (value) => {
                    await p.saveSettings({ language: value as "auto" | "zh" | "en" });
                    p.refresh();
                    this.refreshSettings();
                  }),
              );
            },
          },
        ],
      },
      {
        heading: t("interaction"),
        items: [
          {
            name: t("trigger"),
            desc: t(Platform.isMobile ? "interactionHelpMobile" : "interactionHelp"),
            aliases: ["drag", "handle", "row", "拖拽", "手柄", "整行"],
            render: (setting) => {
              setting.addDropdown((dropdown) =>
                dropdown
                  .addOptions({ row: t("row"), handle: t("handle") })
                  .setValue(p.settings.trigger)
                  .onChange(async (value) => {
                    await p.saveSettings({ trigger: value as "row" | "handle" });
                    p.refresh();
                  }),
              );
            },
          },
          {
            name: t("delay"),
            desc: t(Platform.isMobile ? "delayHelpMobile" : "delayHelp"),
            aliases: ["delay", "long press", "延迟", "长按"],
            render: (setting) => {
              const valueEl = requireApiVersion("1.13.0")
                ? null
                : setting.controlEl.createSpan({
                    cls: "qt-delay-value",
                    text: `${p.settings[key]} ms`,
                  });
              setting.addSlider((slider) =>
                slider
                  .setLimits(180, 800, 10)
                  .setValue(p.settings[key])
                  .onChange(async (value) => {
                    p.cancelDrags();
                    valueEl?.setText(`${value} ms`);
                    await p.saveSettings({ [key]: value });
                  }),
              );
            },
          },
        ],
      },
    ];
    // Hiding these controls must not erase desktop-configured exclusions.
    if (!Platform.isMobile)
      groups.push({
        heading: t("ordering"),
        items: [
          {
            name: t("exclusions"),
            desc: t("exclusionsHelp"),
            aliases: ["assets", "exclude", "排除", "附件"],
            render: (setting) => this.renderExclusions(setting),
          },
        ],
      });
    if (p.store.error)
      groups.push({ heading: t("error"), items: [{ name: t("readError"), render: () => {} }] });
    return groups;
  }
  private async exclusions(next: string[]) {
    const p = this.plugin;
    p.cancelDrags();
    try {
      await p.saveSettings({ excluded: next });
      p.refresh();
      this.refreshSettings();
    } catch (error) {
      p.report(error);
    }
  }
  private renderExclusions(setting: Setting) {
    const p = this.plugin,
      t = p.t;
    setting.settingEl.addClass("qt-exclusions-field");
    const container = setting.controlEl;
    const list = container.createDiv({ cls: "qt-exclusion-list" });
    if (!p.settings.excluded.length)
      list.createEl("p", { cls: "qt-empty", text: t("noExclusions") });
    for (const path of p.settings.excluded) {
      const row = list.createDiv({ cls: "qt-exclusion-row" });
      setIcon(row.createSpan({ cls: "qt-folder-icon" }), "folder");
      row.createSpan({ text: path, cls: "qt-folder-path", attr: { title: path } });
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
    const add = container.createDiv({ cls: "qt-add-directory" });
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
        p.app,
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
    const attachment = container.createEl("button", {
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
  }
}
