(async () => {
  if (app.vault.getName() !== "Quiet Tree QA") throw Error("Isolated QA vault required");
  let p = app.plugins.plugins["quiet-tree"];
  const adapter = app.vault.adapter;
  const path = p.manifest.dir + "/data.json";
  const original = await adapter.read(path);
  app.setting.close();
  app.workspace.leftSplit.expand();
  p.syncViews();
  const initialPlugin = p;
  for (let i = 0; i < 40 && !document.querySelector(".tree-item-self[data-path]"); i++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const view = [...p.views.keys()][0];
  const sorted = () => view.getSortedFolderItems(app.vault.getRoot()).map((item) => item.file.name);
  const checks = [];
  const saveData = p.saveData.bind(p);
  let writes = 0;
  p.saveData = async (data) => {
    writes++;
    return saveData(data);
  };
  try {
    const remote = JSON.parse(original);
    remote.orderState = [
      1,
      [
        ["/", ["B.md", "Z.md", "A", "assets"]],
        ["Future", ["Later.md"]],
      ],
    ];
    remote.trigger = "handle";
    remote.delay = 650;
    await adapter.write(path, JSON.stringify(remote));
    await p.onExternalSettingsChange();
    check(
      sorted()[0] === "B.md" && p.store.order.A === undefined,
      "Synced snapshot did not fully replace native sorting",
    );
    check(
      p.settings.delay === 650 && p.settings.trigger === "handle",
      "Synced settings did not load",
    );
    check(writes === 0, "Sync callback wrote data back");
    check(
      view.navFileContainerEl.querySelector(".qt-handle"),
      "Synced trigger did not update handles",
    );
    checks.push("External settings and complete snapshot hot reload without writeback");
    await p.saveSettings({ mouseDelay: 260 });
    check(
      JSON.stringify(JSON.parse(await adapter.read(path)).orderState) ===
        JSON.stringify(remote.orderState),
      "Settings save lost synced order",
    );
    checks.push("Settings save retains latest synced snapshot");
    // Malformed JSON must not be mistaken for a missing file by Obsidian loadData.
    const errors = [];
    const report = p.report;
    p.report = (error) => errors.push(error.message);
    await adapter.write(path, '{"orderState":');
    await p.onExternalSettingsChange();
    check(p.store.error && sorted()[0] === "B.md", "Malformed JSON discarded last valid display");
    await p.saveSettings({ mouseDelay: 280 }).then(
      () => {
        throw Error("Invalid data was overwritten");
      },
      () => {},
    );
    check((await adapter.read(path)) === '{"orderState":', "Malformed file was overwritten");
    p.report = report;
    checks.push("Malformed data retained and writes rejected");
    await adapter.write(path, original);
    await p.onExternalSettingsChange();
    check(!p.store.error && sorted()[0] === "Z.md", "Valid sync recovery failed");
    // A real cross-directory move must persist settings + order, and roll back on save failure.
    await p.move(view, "A/C.md", { parentId: null, beforeId: "B.md", depth: 0, kind: "insert" });
    check(
      app.vault.getAbstractFileByPath("C.md") && p.store.order["/"].includes("C.md"),
      "Move did not persist unified data",
    );
    const moved = await adapter.read(path);
    p.saveData = async () => {
      throw Error("simulated disk full");
    };
    p.report = (error) => errors.push(error.message);
    await p.move(view, "C.md", { parentId: "A", beforeId: "A/B.md", depth: 1, kind: "insert" });
    check(
      app.vault.getAbstractFileByPath("C.md") && !app.vault.getAbstractFileByPath("A/C.md"),
      "Failed move did not roll back",
    );
    check((await adapter.read(path)) === moved, "Failed move corrupted data");
    p.saveData = saveData;
    p.report = report;
    await p.move(view, "C.md", { parentId: "A", beforeId: "A/B.md", depth: 1, kind: "insert" });
    check(app.vault.getAbstractFileByPath("A/C.md"), "Move-back failed");
    checks.push("Cross-directory move saves unified data and rolls back on write failure");
    await adapter.write(path, original);
    await p.onExternalSettingsChange();
    await app.plugins.unloadPlugin("quiet-tree");
    await app.plugins.loadPlugin("quiet-tree");
    p = app.plugins.plugins["quiet-tree"];
    check(
      p.store.order["/"][0] === "Z.md" && p.settings.excluded.includes("assets"),
      "Reload lost data",
    );
    checks.push("Reload preserves order and exclusions");
    return { mobile: qtTestApi.Platform.isMobile, checks };
  } finally {
    if (p === initialPlugin) p.saveData = saveData;
    await adapter.write(path, original);
    await p.onExternalSettingsChange();
  }
})();
