(async () => {
  if (app.vault.getName() !== "Quiet Tree QA")
    throw Error("Only run in the isolated Quiet Tree QA vault");
  const checks = [];
  const check = (value, label) => {
    if (!value) throw Error(label);
    checks.push(label);
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  app.setting.close();
  const p = app.plugins.plugins["quiet-tree"];
  const leaf = app.workspace.getLeavesOfType("file-explorer")[0];
  await leaf.loadIfDeferred();
  app.workspace.leftSplit.expand();
  p.syncViews();
  const view = leaf.view;
  const drag = p.views.get(view)?.drag;
  check(Boolean(drag), "Native explorer bound");
  check(
    JSON.stringify(view.getSortedFolderItems(app.vault.getRoot()).map((i) => i.file.name)) ===
      JSON.stringify(["Z.md", "A", "B.md", "assets"]),
    "Custom root order loaded",
  );
  check(
    p.settings.excluded.includes("assets") && !p.store.order.assets,
    "Assets exclusion retained",
  );
  const before = JSON.stringify(p.store.order);
  p.settings.trigger = "row";
  p.refresh();
  for (let i = 0; i < 40 && !view.fileItems["Z.md"]?.selfEl.classList.contains("qt-sortable"); i++)
    await sleep(50);
  const row = view.fileItems["Z.md"].selfEl;
  check(!view.navFileContainerEl.querySelector(".qt-handle"), "Row mode creates no handles");
  check(row.classList.contains("qt-sortable"), "Row remains sortable without handle");
  const rect = row.getBoundingClientRect(),
    x = rect.left + 75,
    y = rect.top + rect.height / 2;
  const pointer = (type, px = x, py = y) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerType: "mouse",
      pointerId: 7,
      isPrimary: true,
      button: 0,
      clientX: px,
      clientY: py,
    });
  row.dispatchEvent(pointer("pointerdown"));
  check(!row.querySelector(".qt-hold-progress"), "No progress line on press");
  row.dispatchEvent(pointer("pointerup"));
  check(!drag.press && !document.querySelector(".qt-ghost"), "Short mouse press does not lift");
  row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  await sleep(50);
  check(app.workspace.getActiveFile()?.path === "Z.md", "Normal click opens the note");
  app.workspace.leftSplit.expand();
  await sleep(350);
  row.dispatchEvent(pointer("pointerdown"));
  await sleep(p.settings.mouseDelay + 30);
  check(!drag.press.active, "Stationary mouse waits for movement");
  row.dispatchEvent(pointer("pointermove", x + 5, y));
  check(
    drag.press.active && Boolean(document.querySelector(".qt-ghost")),
    "Mouse lifts after configured delay and movement",
  );
  drag.cancel();
  const touchEvent = (type, px, py, ended = false) => {
    const touch = new Touch({ identifier: 19, target: row, clientX: px, clientY: py });
    return new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      touches: ended ? [] : [touch],
      targetTouches: ended ? [] : [touch],
      changedTouches: [touch],
    });
  };
  row.dispatchEvent(touchEvent("touchstart", x, y));
  const scroll = touchEvent("touchmove", x, y + 12);
  row.dispatchEvent(scroll);
  check(!drag.press && !scroll.defaultPrevented, "Early touch swipe keeps native scrolling");
  row.dispatchEvent(touchEvent("touchend", x, y + 12, true));
  row.dispatchEvent(touchEvent("touchstart", x, y));
  await sleep(250);
  check(!drag.press.active, "Touch does not lift at the mouse delay");
  await sleep(Math.max(0, p.settings.delay - 250) + 50);
  check(drag.press.active, "Touch lifts at configured touch delay");
  const context = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  row.dispatchEvent(context);
  check(context.defaultPrevented, "Native long-press context menu blocked for active drag");
  const move = touchEvent("touchmove", x, y + 5);
  row.dispatchEvent(move);
  check(move.defaultPrevented, "Active touch drag prevents scrolling");
  drag.cancel();
  p.settings.trigger = "handle";
  p.refresh();
  await sleep(30);
  check(Boolean(row.querySelector(".qt-handle")), "Handle mode creates handles");
  row.dispatchEvent(pointer("pointerdown"));
  check(!drag.press, "Handle mode ignores row press");
  row.querySelector(".qt-handle").dispatchEvent(pointer("pointerdown"));
  check(Boolean(drag.press), "Handle itself starts drag preparation");
  drag.cancel();
  p.settings.trigger = "row";
  p.refresh();
  check(
    !view.navFileContainerEl.querySelector(".qt-handle"),
    "Returning to row mode removes handles",
  );
  check(JSON.stringify(p.store.order) === before, "All canceled gestures preserve ordering");
  await p.saveSettings({ trigger: "row" });
  app.setting.open();
  app.setting.openTabById("quiet-tree");
  const tab = app.setting.activeTab;
  const definitions = tab.getSettingDefinitions().flatMap((g) => g.items ?? []);
  const mobile = qtTestApi.Platform.isMobile;
  check(definitions.length === (mobile ? 3 : 4), "Platform settings expose only intended controls");
  check(
    definitions.every((d) => Boolean(d.name) && Boolean(d.aliases?.length)),
    "Every control has searchable definitions",
  );
  check(
    !tab.containerEl.querySelector(".qt-path-field"),
    "No storage path picker on either platform",
  );
  check(
    mobile
      ? !tab.containerEl.querySelector(".qt-exclusion-list")
      : Boolean(tab.containerEl.querySelector(".qt-exclusion-list")),
    "Exclusions UI visibility follows platform",
  );
  check(
    !mobile || !tab.containerEl.innerText.includes("4 像素"),
    "Mobile help has no desktop movement rule",
  );
  return { version: qtTestApi.apiVersion, mobile, checks };
})();
