(async () => {
  if (app.vault.getName() !== "Obsidian Sandbox") throw Error("Sandbox only");
  const p = app.plugins.plugins["quiet-tree"];
  const view = app.workspace.getLeavesOfType("file-explorer")[0].view;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const results = [],
    metrics = {};
  const check = (value, label) => {
    if (!value) throw Error(label);
    results.push(label);
  };
  let panel, synthetic;
  const trigger = p.settings.trigger;
  const before = JSON.stringify(p.store.order);
  const enabled = app.plugins.enabledPlugins;
  check(
    p.manifest.version === "0.4.1" && p.views.has(view),
    "0.4.1 binds native explorer after legacy migration",
  );
  try {
    p.settings.trigger = "handle";
    if (!enabled.has("custom-sort")) {
      enabled.add("custom-sort");
      try {
        p.syncViews();
        check(p.suspended && p.views.size === 0, "conflict suspends bindings");
      } finally {
        enabled.delete("custom-sort");
        p.syncViews();
      }
      check(!p.suspended && p.views.has(view), "disabling conflict restores bindings");
    }
    // Count actual layout reads, rather than asserting wall-clock timings.
    panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "400px",
      height: "280px",
      overflow: "auto",
      zIndex: "-1",
    });
    const rows = [],
      nodes = Object.create(null);
    let reads = 0;
    const mountRow = (id) => {
      const row = document.createElement("div");
      row.className = "tree-item-self";
      row.dataset.path = id;
      row.style.cssText = "height:28px;min-height:28px;box-sizing:border-box;";
      row.textContent = id;
      const measure = row.getBoundingClientRect.bind(row);
      row.getBoundingClientRect = () => {
        reads++;
        return measure();
      };
      return row;
    };
    for (let i = 0; i < 300; i++) {
      const id = `note-${i}.md`;
      rows.push({ id, depth: 0 });
      nodes[id] = { id, name: id, parentId: null, kind: "file", children: [] };
      panel.append(mountRow(id));
    }
    document.body.append(panel);
    const Controller = p.views.get(view).drag.constructor;
    synthetic = new Controller(p, {
      navFileContainerEl: panel,
      fileItems: {},
      searchQuery: "",
    });
    synthetic.data = {
      tree: { nodes, roots: rows.map((row) => row.id) },
      rows,
    };
    synthetic.measured();
    await wait(60); // First ResizeObserver delivery is expected to invalidate once.
    synthetic.measured();
    await wait(60);
    // A hidden sandbox can defer the initial observer delivery. Warm the cache
    // after those deliveries before counting repeated synchronous measurements.
    synthetic.measured();
    const baseline = reads;
    const started = performance.now();
    for (let i = 0; i < 60; i++) synthetic.measured();
    metrics.cachedMeasurementMs = +(performance.now() - started).toFixed(3);
    metrics.rows = rows.length;
    metrics.repeatedMeasurements = 60;
    metrics.warmRowLayoutReads = reads - baseline;
    check(reads === baseline, "60 repeated measurements reuse row geometry without layout reads");
    const first = synthetic.measured()[0].rect.top;
    panel.scrollTop = 84;
    await wait(30);
    check(
      Math.abs(synthetic.measured()[0].rect.top - (first - 84)) < 1,
      "scroll offsets translate cached geometry correctly",
    );
    const old = panel.firstElementChild;
    const replacement = mountRow("note-0.md");
    old.replaceWith(replacement);
    await wait(60);
    check(
      synthetic.measured()[0].el === replacement && !!replacement.querySelector(".qt-handle"),
      "virtual row replacement refreshes geometry and decorates the new row",
    );
    replacement.style.height = "42px";
    await wait(60);
    check(
      synthetic.measured()[0].rect.height === 42,
      "row height changes invalidate cached geometry",
    );
    synthetic.destroy();
    synthetic = null;
    check(
      !panel.querySelector(".qt-handle"),
      "destroy removes handles and observers after cached measurements",
    );
    panel.remove();
    panel = null;
  } finally {
    synthetic?.destroy();
    panel?.remove();
    p.settings.trigger = trigger;
    p.refresh();
  }
  check(JSON.stringify(p.store.order) === before, "QA preserves existing custom order");
  return JSON.stringify({ results, metrics });
})();
