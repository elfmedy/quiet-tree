(async () => {
  if (app.vault.getName() !== "Obsidian Sandbox") throw Error("Sandbox only");
  const vault = app.vault;
  let p = app.plugins.plugins["quiet-tree"];
  const leaf = app.workspace.getLeavesOfType("file-explorer")[0];
  await leaf.loadIfDeferred();
  const view = leaf.view;
  if (!p?.stable || view.sortOrder !== "alphabetical")
    throw Error("Stable build and alphabetical native order required");
  const base = "Quiet Tree Stable QA " + Date.now();
  if (vault.getAbstractFileByPath(base)) throw Error("Fixture collision");
  await p.flushChanges();
  const before = JSON.stringify(p.store.order);
  const rootBefore = p.store.order["/"] ? [...p.store.order["/"]] : undefined;
  const excludedBefore = [...p.settings.excluded];
  const checks = [];
  const check = (value, label) => {
    if (!value) throw Error(label);
    checks.push(label);
  };
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const settle = async () => {
    await p.flushChanges();
    await p.store.settled();
    await wait(40);
  };
  const path = (name) => base + "/" + name;
  const names = (name) =>
    view
      .getSortedFolderItems(vault.getAbstractFileByPath(path(name)))
      .map((item) => item.file.name);
  async function folder(name, files = ["B.md", "D.md", "F.md"], manual) {
    await vault.createFolder(path(name));
    for (const file of files) await vault.create(path(name) + "/" + file, "");
    await settle();
    await p.resetFolder(path(name));
    if (manual) {
      await p.store.update((order) => {
        order[path(name)] = manual;
        return order;
      });
      p.stable.rebase(p.store.order, [], p.store.rules);
      p.refresh();
    }
    await wait(40);
    names(name);
  }
  async function rename(dir, from, to) {
    await app.fileManager.renameFile(
      vault.getAbstractFileByPath(path(dir) + "/" + from),
      path(dir) + "/" + to,
    );
  }
  await vault.createFolder(base);
  try {
    for (const [dir, manual] of [
      ["Unrecorded", undefined],
      ["Partial", ["F.md"]],
      ["Complete", ["F.md", "B.md", "D.md"]],
    ]) {
      await folder(dir, undefined, manual);
      const expected = names(dir).map((n) => (n === "B.md" ? "Z.md" : n));
      await rename(dir, "B.md", "Z.md");
      check(
        equal(names(dir), expected),
        dir + " rename preserves position immediately before saving",
      );
      await settle();
      check(
        equal(p.store.order[path(dir)], expected),
        dir + " rename persists the complete display order",
      );
    }
    await folder("Create", ["B.md", "D.md"]);
    await vault.create(path("Create") + "/Z.md", "");
    await vault.create(path("Create") + "/A.canvas", "{}");
    await rename("Create", "A.canvas", "0.canvas");
    await vault.createFolder(path("Create") + "/A folder");
    check(
      equal(names("Create"), ["B.md", "D.md", "Z.md", "0.canvas", "A folder"]),
      "files and folders append in creation order, including immediate rename",
    );
    await settle();
    await vault.delete(vault.getAbstractFileByPath(path("Create") + "/B.md"), true);
    await vault.create(path("Create") + "/B.md", "");
    await settle();
    check(
      equal(names("Create"), ["D.md", "Z.md", "0.canvas", "A folder", "B.md"]),
      "delete/recreate appends without a duplicate or old slot",
    );

    await folder("Source", ["B.md", "D.md"]);
    await folder("Destination", ["F.md", "G.md"]);
    await app.fileManager.renameFile(
      vault.getAbstractFileByPath(path("Source") + "/B.md"),
      path("Destination") + "/B.md",
    );
    check(
      equal(names("Source"), ["D.md"]) && equal(names("Destination"), ["F.md", "G.md", "B.md"]),
      "native cross-folder move preserves source and appends at destination",
    );
    await settle();
    await p.move(view, path("Destination") + "/B.md", {
      parentId: path("Destination"),
      beforeId: path("Destination") + "/F.md",
      kind: "insert",
      depth: 2,
    });
    check(
      equal(names("Destination"), ["B.md", "F.md", "G.md"]),
      "explicit Quiet Tree drop position takes priority over append policy",
    );

    await folder("Concurrent source", ["B.md", "D.md"]);
    await folder("Concurrent destination", ["F.md", "G.md"]);
    const saveDuringMove = p.store.io.save;
    let releaseMove, startedMove;
    const moveSaving = new Promise((resolve) => {
      startedMove = resolve;
    });
    p.store.io.save = async (data) => {
      startedMove();
      await new Promise((resolve) => {
        releaseMove = resolve;
      });
      await saveDuringMove(data);
    };
    const moving = p.move(view, path("Concurrent source") + "/B.md", {
      parentId: path("Concurrent destination"),
      beforeId: path("Concurrent destination") + "/F.md",
      kind: "insert",
      depth: 2,
    });
    try {
      await moveSaving;
      await vault.create(path("Concurrent source") + "/C.md", "");
      await wait(150); // Also let the event debounce expire while the move is saving.
    } finally {
      p.store.io.save = saveDuringMove;
      releaseMove();
      await moving;
    }
    await settle();
    check(
      equal(p.store.order[path("Concurrent source")], ["D.md", "C.md"]),
      "create during a pending cross-folder drop cannot record a ghost source item",
    );
    await vault.create(path("Concurrent source") + "/B.md", "");
    await settle();
    check(
      equal(names("Concurrent source"), ["D.md", "C.md", "B.md"]),
      "recreating the moved-out name still appends after a concurrent save",
    );

    await folder("Closed", ["B.md", "D.md"]);
    await folder("Parent", []);
    await vault.createFolder(path("Parent") + "/Sub");
    await vault.create(path("Parent") + "/Sub/B.md", "");
    await vault.create(path("Parent") + "/Sub/D.md", "");
    await settle();
    await p.resetFolder(path("Parent") + "/Sub");
    const rawBeforeReload = await vault.adapter.read(p.manifest.dir + "/data.json");
    await app.plugins.unloadPlugin("quiet-tree");
    await app.plugins.loadPlugin("quiet-tree");
    p = app.plugins.plugins["quiet-tree"];
    p.syncViews();
    check(
      (await vault.adapter.read(p.manifest.dir + "/data.json")) === rawBeforeReload,
      "reload seeds memory without rewriting any ordering data",
    );
    check(
      equal(names("Create"), ["D.md", "Z.md", "0.canvas", "A folder", "B.md"]),
      "persisted order survives a real plugin reload",
    );
    await vault.create(path("Create") + "/Reload.md", "");
    await app.plugins.unloadPlugin("quiet-tree");
    await app.plugins.loadPlugin("quiet-tree");
    p = app.plugins.plugins["quiet-tree"];
    check(
      equal(names("Create"), ["D.md", "Z.md", "0.canvas", "A folder", "B.md", "Reload.md"]),
      "immediate reload waits for the previous instance's pending save",
    );
    await rename("Closed", "B.md", "Z.md");
    check(
      equal(names("Closed"), ["Z.md", "D.md"]),
      "unopened directory baseline is seeded before its first rename",
    );
    await app.fileManager.renameFile(
      vault.getAbstractFileByPath(path("Parent")),
      path("Renamed parent"),
    );
    await app.fileManager.renameFile(
      vault.getAbstractFileByPath(path("Renamed parent") + "/Sub/B.md"),
      path("Renamed parent") + "/Sub/Z.md",
    );
    await settle();
    check(
      equal(p.store.order[path("Renamed parent") + "/Sub"], ["Z.md", "D.md"]),
      "folder rename carries unopened descendant baselines",
    );

    await folder("Excluded", []);
    await p.saveSettings({ excluded: [...excludedBefore, path("Excluded")] });
    await vault.create(path("Excluded") + "/Z.md", "");
    await vault.create(path("Excluded") + "/A.md", "");
    await settle();
    check(
      !p.store.order[path("Excluded")] && equal(names("Excluded"), ["A.md", "Z.md"]),
      "excluded directories keep native order without recording their children",
    );

    await folder("Failed save", ["B.md", "D.md"]);
    const save = p.store.io.save;
    p.store.io.save = async () => {
      throw Error("QA disk full");
    };
    try {
      await vault.create(path("Failed save") + "/A.md", "");
      let failed = false;
      try {
        await p.flushChanges();
      } catch {
        failed = true;
      }
      check(
        failed &&
          !p.store.order[path("Failed save")] &&
          equal(names("Failed save"), ["B.md", "D.md", "A.md"]),
        "save failure keeps the unsaved display and pending event without changing saved state",
      );
    } finally {
      p.store.io.save = save;
    }
    await settle();
    check(
      equal(p.store.order[path("Failed save")], ["B.md", "D.md", "A.md"]),
      "failed event can be retried and persisted once",
    );

    await folder("Sync", ["B.md", "D.md"]);
    await vault.create(path("Sync") + "/Z.md", "");
    const data = await p.loadData();
    data.orderState[1] = data.orderState[1].filter(([key]) => key !== path("Sync"));
    data.orderState[1].push([path("Sync"), ["Z.md", "D.md", "B.md"]]);
    await vault.adapter.write(p.manifest.dir + "/data.json", JSON.stringify(data, null, 2));
    await p.onExternalSettingsChange();
    await settle();
    check(
      equal(names("Sync"), ["Z.md", "D.md", "B.md"]),
      "an arriving synced snapshot determines ranks even with a pending create",
    );
    await p.resetFolder(path("Sync"));
    await rename("Sync", "B.md", "0.md");
    await settle();
    check(
      equal(names("Sync"), ["0.md", "D.md", "Z.md"]),
      "reset restores native baseline for the next rename",
    );
  } finally {
    p.cancelDrags();
    await p.saveSettings({ excluded: excludedBefore });
    const fixture = vault.getAbstractFileByPath(base);
    if (fixture?.path === base) await vault.delete(fixture, true);
    await settle();
    await p.store.update((order) => {
      if (rootBefore) order["/"] = rootBefore;
      else delete order["/"];
      return order;
    });
    p.stable.forget("/");
    p.stable.rebase(p.store.order, [], p.store.rules);
    p.refresh();
  }
  check(
    JSON.stringify(p.store.order) === before,
    "existing ordering restored after removing the isolated fixture",
  );
  return JSON.stringify({ checks, count: checks.length });
})();
