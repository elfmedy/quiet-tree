(async () => {
  if (app.vault.getName() !== "Quiet Tree QA")
    throw Error("Only run in the isolated Quiet Tree QA vault");
  app.setting.close();
  await app.plugins.unloadPlugin("quiet-tree");
  app.workspace.rightSplit.collapse();
  const leaf = app.workspace.getRightLeaf(true);
  await leaf.setViewState({
    type: "file-explorer",
    icon: "folder",
    title: "Deferred QA explorer",
    active: false,
    state: {},
  });
  const deferredBefore = leaf.isDeferred;
  const oldGuardWouldReject = typeof leaf.view.getSortedFolderItems !== "function";
  try {
    if (!deferredBefore || !oldGuardWouldReject)
      throw Error("Failed to construct a real deferred explorer");
    await app.plugins.loadPlugin("quiet-tree");
    const p = app.plugins.plugins["quiet-tree"];
    for (let i = 0; i < 80 && (leaf.isDeferred || !p.views.has(leaf.view)); i++)
      await new Promise((r) => setTimeout(r, 25));
    if (leaf.isDeferred || !p.views.has(leaf.view)) throw Error("Deferred explorer was not bound");
    const rootOrder = leaf.view.getSortedFolderItems(app.vault.getRoot()).map((i) => i.file.name);
    if (JSON.stringify(rootOrder) !== JSON.stringify(["Z.md", "A", "B.md", "assets"]))
      throw Error("Deferred explorer sort mismatch");
    return {
      deferredBefore,
      oldGuardWouldReject,
      loadedAfter: !leaf.isDeferred,
      boundAfter: p.views.has(leaf.view),
      rootOrder,
    };
  } finally {
    leaf.detach();
  }
})();
