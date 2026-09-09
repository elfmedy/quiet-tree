(async () => {
  if (app.vault.getName() !== "Obsidian Sandbox") throw Error("Sandbox required");
  const adapter = app.vault.adapter;
  let p = app.plugins.plugins["quiet-tree"];
  const home = p.manifest.dir;
  const path = home + "/data.json";
  const original = await adapter.read(path);
  const files = JSON.stringify(
    app.vault
      .getFiles()
      .map((file) => file.path)
      .sort(),
  );
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw Error(message);
    checks.push(message);
  };
  const reject = async (action, key) => {
    let caught;
    try {
      await action();
    } catch (error) {
      caught = error;
    }
    check(caught?.message === key, "Reject " + key);
  };
  const reload = async () => {
    app.setting.close();
    await app.plugins.unloadPlugin("quiet-tree");
    await app.plugins.loadPlugin("quiet-tree");
    p = app.plugins.plugins["quiet-tree"];
  };
  const backups = async () => (await adapter.list(home + "/backups")).folders;
  const showSettings = () => {
    app.setting.open();
    app.setting.openTabById("quiet-tree");
    p.settingsTab.refreshSettings();
    return app.setting.activeTab.containerEl;
  };
  const button = (root, label) =>
    [...root.querySelectorAll("button")].find((item) => item.textContent === label);
  const resetModal = async () => {
    for (let i = 0; i < 30; i++) {
      const modal = [...p.settingsTab.containerEl.ownerDocument.querySelectorAll(".modal")].find(
        (item) => item.textContent.includes(p.t("resetDataHelp")),
      );
      if (modal) return modal;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  try {
    const legacyPath = home + "/sort-order.json";
    const legacyText = await adapter.read(legacyPath);
    const legacyOrder = JSON.parse(legacyText);
    const old = { language: "zh", jsonPath: legacyPath, trigger: "row", delay: 340, excluded: [] };
    const before = await backups();
    await adapter.write(path, JSON.stringify(old));
    await reload();
    const migrated = JSON.parse(await adapter.read(path));
    check(migrated.dataVersion === 1 && !p.store.error, "Old install upgrades on plugin startup");
    check(
      JSON.stringify(Object.fromEntries(migrated.orderState[1])) === JSON.stringify(legacyOrder),
      "All legacy folder orders preserved",
    );
    check(
      migrated.delay === 340 && migrated.mouseDelay === 200 && migrated.jsonPath === undefined,
      "Settings preserved and legacy reference removed",
    );
    const added = (await backups()).filter((dir) => !before.includes(dir));
    check(added.length === 1, "Exactly one upgrade backup created");
    check(
      JSON.stringify(JSON.parse(await adapter.read(added[0] + "/data.json"))) ===
        JSON.stringify(old) && (await adapter.read(added[0] + "/sort-order.json")) === legacyText,
      "Both original data sources backed up",
    );
    await reload();
    check((await backups()).length === before.length + 1, "Restart does not repeat migration");
    await p.saveSettings({ trigger: "handle" });
    check(
      JSON.stringify(p.store.order) === JSON.stringify(legacyOrder),
      "Settings remain writable after upgrade",
    );

    const future = JSON.stringify({ ...migrated, dataVersion: 2 });
    await adapter.write(path, future);
    await reject(() => p.store.load(), "newerDataVersion");
    let settings = showSettings();
    check(
      settings.textContent.includes(p.t("newerDataVersion")) && !button(settings, p.t("resetData")),
      "Future version explains updating and offers no reset",
    );
    check((await adapter.read(path)) === future, "Future data remains untouched");

    const broken =
      '{"dataVersion":1,"language":"zh","trigger":"handle","delay":340,"excluded":["assets"],"orderState":null}';
    await adapter.write(path, broken);
    await reject(() => p.store.load(), "invalidJson");
    const recoverBefore = await backups();
    settings = showSettings();
    const reset = button(settings, p.t("resetData"));
    check(!!reset, "Invalid data exposes recovery in actual settings");
    reset.click();
    let modal = await resetModal();
    check(
      !!modal?.textContent.includes(p.t("resetDataHelp")),
      "Reset asks for confirmation and explains synchronization",
    );
    button(modal, p.t("keepData")).click();
    check(
      (await adapter.read(path)) === broken && (await backups()).length === recoverBefore.length,
      "Cancelling confirmation leaves data and backups unchanged",
    );
    reset.click();
    modal = await resetModal();
    button(modal, p.t("confirmResetData")).click();
    await p.store.settled();
    const recovered = JSON.parse(await adapter.read(path));
    check(
      recovered.dataVersion === 1 && recovered.orderState[1].length === 0 && !p.store.error,
      "Confirmed reset creates usable versioned data",
    );
    const resetBackups = (await backups()).filter((dir) => !recoverBefore.includes(dir));
    check(
      resetBackups.length === 1 && (await adapter.read(resetBackups[0] + "/data.json")) === broken,
      "Recovery backs up exact corrupt contents",
    );
    check(
      recovered.language === "zh" &&
        recovered.trigger === "handle" &&
        recovered.delay === 340 &&
        recovered.excluded[0] === "assets",
      "Recovery preserves recognizable settings",
    );
    await p.saveSettings({ delay: 410 });
    check(JSON.parse(await adapter.read(path)).delay === 410, "Recovered file accepts later saves");
    check(
      JSON.stringify(
        app.vault
          .getFiles()
          .map((file) => file.path)
          .sort(),
      ) === files,
      "No notes moved or removed",
    );
    return { mobile: document.body.classList.contains("is-mobile"), checks };
  } finally {
    app.setting.close();
    await adapter.write(path, original);
    await reload();
  }
})();
