(async () => {
  if (app.vault.getName() !== "Obsidian Sandbox") throw Error("Sandbox required");
  const p = app.plugins.plugins["quiet-tree"];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const checks = [];
  const check = (value, label) => {
    if (!value) throw Error(label);
    checks.push(label);
  };
  const base = "Quiet Tree 交互测试",
    source = base + "/A/C.md";
  for (const path of [base, base + "/A", base + "/D"])
    if (!app.vault.getAbstractFileByPath(path)) await app.vault.createFolder(path);
  for (const name of ["B", "C"])
    if (!app.vault.getAbstractFileByPath(base + "/A/" + name + ".md"))
      await app.vault.create(base + "/A/" + name + ".md", "");
  await p.store.update((order) => {
    order[base] = ["A", "D"];
    order[base + "/A"] = ["B.md", "C.md"];
    return order;
  });
  p.refresh();
  app.setting.close();
  const leaf = app.workspace.getLeavesOfType("file-explorer")[0];
  await leaf.loadIfDeferred();
  app.workspace.leftSplit.expand();
  p.syncViews();
  const view = leaf.view,
    drag = p.views.get(view).drag;
  const before = await app.vault.adapter.read(p.manifest.dir + "/data.json");
  const trigger = p.settings.trigger;
  p.settings.trigger = "row";
  const focus = async () => {
    await view.fileItems[base].setCollapsed(false);
    await view.fileItems[base + "/A"].setCollapsed(false);
    view.revealInFolder(app.vault.getAbstractFileByPath(source));
    await sleep(150);
    const bounds = view.navFileContainerEl.getBoundingClientRect();
    const sourceRect = view.fileItems[source].selfEl.getBoundingClientRect();
    view.navFileContainerEl.scrollTop += sourceRect.top - (bounds.top + bounds.height / 2);
    await sleep(100);
    drag.decorate();
  };
  await focus();
  const row = view.fileItems[source].selfEl;
  const pointer = (type, x, y) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerType: "mouse",
      pointerId: 17,
      isPrimary: true,
      button: 0,
      clientX: x,
      clientY: y,
    });
  const touch = (type, x, y, ended = false) => {
    const finger = new Touch({ identifier: 23, target: row, clientX: x, clientY: y });
    return new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      touches: ended ? [] : [finger],
      targetTouches: ended ? [] : [finger],
      changedTouches: [finger],
    });
  };
  try {
    let r = row.getBoundingClientRect(),
      x = r.left + 65,
      y = r.top + r.height / 2;
    row.dispatchEvent(pointer("pointerdown", x, y));
    check(!document.querySelector(".qt-ghost-cancel"), "Pending press shows no cancel hint");
    await sleep(p.settings.mouseDelay + 30);
    row.dispatchEvent(pointer("pointermove", x + 5, y));
    await sleep(80);
    if (drag.press?.active) drag.resolve();
    check(
      drag.press.active && document.querySelector(".qt-ghost-cancel kbd")?.textContent === "Esc",
      "Lifted mouse card shows Esc key",
    );
    check(drag.line.hidden, "Ordinary source center keeps guide hidden");
    row.dispatchEvent(pointer("pointermove", x + 5, r.bottom - 2));
    drag.resolve();
    await sleep(300);
    drag.resolve();
    check(
      drag.picker && drag.hit.noOp && !drag.line.hidden && !drag.guide.hidden,
      "Last-child no-op boundary shows both guides",
    );
    check(
      drag.pickerEl.querySelector(".is-selected .qt-picker-text > span").textContent ===
        p.t("unchanged"),
      "No-op option explicitly keeps current position",
    );
    const innerX = drag.line.style.transform,
      innerTop = drag.guide.style.top;
    const picker = drag.picker;
    row.dispatchEvent(
      pointer(
        "pointermove",
        picker.left + 30,
        picker.top + picker.header + picker.slotHeight * 1.5,
      ),
    );
    await sleep(80);
    if (drag.press?.active) drag.resolve();
    check(
      !drag.hit.noOp &&
        !drag.line.hidden &&
        !drag.guide.hidden &&
        drag.line.style.transform !== innerX &&
        drag.guide.style.top !== innerTop,
      "Outer choice changes indentation and parent guide range",
    );
    const card = drag.ghost.getBoundingClientRect();
    const chooser = drag.pickerEl.getBoundingClientRect();
    check(
      card.bottom <= chooser.top || card.top >= chooser.bottom ||
        card.right <= chooser.left || card.left >= chooser.right,
      "Chooser does not cover the Esc hint",
    );
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    check(
      !drag.press && !document.querySelector(".qt-ghost"),
      "Escape cancels and removes feedback",
    );
    await focus();
    r = row.getBoundingClientRect();
    x = r.left + 65;
    y = r.top + r.height / 2;
    row.dispatchEvent(touch("touchstart", x, y));
    check(!document.querySelector(".qt-cancel-zone"), "Pending touch does not show cancel area");
    await sleep(p.settings.delay + 70);
    check(
      drag.press?.active && drag.cancelZone && !document.querySelector(".qt-ghost-cancel"),
      "Touch lift shows cancel area without Esc hint",
    );
    const zone = drag.cancelZone.getBoundingClientRect(),
      zx = zone.left + zone.width / 2,
      zy = zone.top + zone.height / 2;
    check(
      zone.height >= 64 && zone.bottom <= window.innerHeight && zone.left >= 0,
      "Cancel area fits the viewport",
    );
    row.dispatchEvent(touch("touchmove", zx, zy));
    await sleep(80);
    if (drag.press?.active) drag.resolve();
    check(
      drag.cancelHovered &&
        drag.cancelZone.classList.contains("is-active") &&
        !drag.hit.target &&
        drag.line.hidden &&
        drag.guide.hidden &&
        !drag.picker,
      "Cancel area takes precedence over drop targets",
    );
    const scroll = view.navFileContainerEl.scrollTop;
    await sleep(100);
    check(view.navFileContainerEl.scrollTop === scroll, "Cancel hover stops autoscroll");
    row.dispatchEvent(touch("touchmove", x, y));
    await sleep(80);
    if (drag.press?.active) drag.resolve();
    check(
      !drag.cancelHovered && drag.hit.target && !drag.cancelZone.classList.contains("is-active"),
      "Leaving cancel area resumes dragging",
    );
    // Move and release in one turn: release coordinates must win without an animation frame.
    row.dispatchEvent(touch("touchmove", zx, zy));
    row.dispatchEvent(touch("touchend", zx, zy, true));
    await p.store.settled();
    check(
      !drag.press && !document.querySelector(".qt-cancel-zone"),
      "Fast release in cancel area removes overlays",
    );
    check(
      (await app.vault.adapter.read(p.manifest.dir + "/data.json")) === before &&
        !!app.vault.getAbstractFileByPath(source),
      "All cancellation paths preserve exact data and file location",
    );
    // Exercise the previously failing save against the migrated Sandbox data.
    await p.move(view, source, {
      parentId: base + "/A",
      beforeId: base + "/A/B.md",
      depth: 2,
      kind: "insert",
    });
    check(
      !p.store.error && p.store.order[base + "/A"][0] === "C.md",
      "Sandbox reorder saves successfully after data conversion",
    );
    await p.move(view, source, { parentId: base + "/A", beforeId: null, depth: 2, kind: "insert" });
    check(
      (await app.vault.adapter.read(p.manifest.dir + "/data.json")) === before,
      "Restore test ordering without affecting existing orders",
    );
    return { mobile: document.body.classList.contains("is-mobile"), checks };
  } finally {
    drag.cancel();
    p.settings.trigger = trigger;
    p.refresh();
  }
})();
