import { setIcon } from "obsidian";
import { emptyHit, normalizeHit, resolveTreeHit, type DragHit } from "../lib/drag-hit-test";
import { contains, makeBoundaryPicker, pickerHit, type BoundaryPicker } from "../lib/drag-geometry";
import { isNoopMove, targetKey } from "../lib/explorer-model";
import type QuietTreePlugin from "./main";
import { snapshot, type NativeExplorer, type Snapshot } from "./native";
import { excluded, parentPath } from "./order";
import { destinationLabel, displayName } from "./presentation";

type Press = {
  id: string;
  el: HTMLElement;
  input: "mouse" | "touch";
  startX: number;
  startY: number;
  x: number;
  y: number;
  time: number;
  active: boolean;
  pointer: number;
};
type RowRect = Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width" | "height">;
type Measured = { id: string; index: number; el: HTMLElement; rect: RowRect };
const ROW = 28;
export class DragController {
  private doc: Document;
  private win: Window;
  private dom: Pick<typeof window, "createEl" | "createSpan" | "createDiv">;
  private root: HTMLElement;
  private observer: MutationObserver;
  private disposers: (() => void)[] = [];
  private press: Press | null = null;
  private data: Snapshot | null = null;
  private hit: DragHit = emptyHit;
  private ghost?: HTMLElement;
  private line?: HTMLElement;
  private surface?: HTMLElement;
  private pickerEl?: HTMLElement;
  private cancelZone?: HTMLElement;
  private cancelHovered = false;
  private picker: BoundaryPicker | null = null;
  private pickerKey = "";
  private pickerSince = 0;
  private hoverId = "";
  private hoverSince = 0;
  private timer = 0;
  private frame = 0;
  private decorateFrame = 0;
  private suppressClickUntil = 0;
  private activeFolder?: HTMLElement;
  private destroyed = false;
  private failed = false;
  private resizeObserver: ResizeObserver;
  private themeObserver: MutationObserver;
  private observedRows = new Set<Element>();
  private pendingDecorations = new Set<HTMLElement>();
  private measuredRows: Measured[] | null = null;
  private measuredOrigin = {
    top: 0,
    left: 0,
    scrollTop: 0,
    scrollLeft: 0,
    width: 0,
  };
  private needsResolve = true;
  private snapshotDirty = false;
  private lastBounds = "";
  constructor(
    private plugin: QuietTreePlugin,
    private view: NativeExplorer,
  ) {
    this.root = view.navFileContainerEl;
    this.doc = this.root.ownerDocument;
    this.win = this.doc.defaultView!;
    const realm = this.win as Window & typeof window;
    this.resizeObserver = new realm.ResizeObserver(() => this.invalidateGeometry());
    this.themeObserver = new realm.MutationObserver(() => this.invalidateGeometry());
    // Obsidian installs these global helpers separately in each document's window.
    this.dom = this.win as Window & typeof this.dom;
    this.root.classList.add("qt-explorer");
    this.listen(this.root, "pointerdown", (e) => this.pointerDown(e as PointerEvent), {
      capture: true,
    });
    this.listen(
      this.doc,
      "pointermove",
      (e) => {
        const p = e as PointerEvent;
        if (this.press?.input === "mouse" && p.pointerId === this.press.pointer)
          this.move(p.clientX, p.clientY, p);
      },
      { capture: true, passive: false },
    );
    this.listen(
      this.doc,
      "pointerup",
      (e) => {
        const p = e as PointerEvent;
        if (this.press?.input === "mouse" && p.pointerId === this.press.pointer)
          this.end(p.clientX, p.clientY, p);
      },
      { capture: true },
    );
    this.listen(
      this.doc,
      "pointercancel",
      (e) => {
        if ((e as PointerEvent).pointerType !== "touch") this.cancel();
      },
      { capture: true },
    );
    // Touch Events preserve native scrolling until long-press activation. Pointer Events
    // alone get cancelled by the browser when a scroll begins (touch-action:auto).
    this.listen(this.root, "touchstart", (e) => this.touchStart(e as TouchEvent), {
      capture: true,
      passive: true,
    });
    this.listen(
      this.doc,
      "touchmove",
      (e) => {
        const event = e as TouchEvent;
        if (this.press?.input !== "touch") return;
        const touch = Array.from(event.touches).find((t) => t.identifier === this.press?.pointer);
        if (event.touches.length !== 1 || !touch) {
          this.cancel();
          return;
        }
        this.move(touch.clientX, touch.clientY, event);
      },
      { capture: true, passive: false },
    );
    this.listen(
      this.doc,
      "touchend",
      (e) => {
        const event = e as TouchEvent;
        if (this.press?.input !== "touch") return;
        const touch = Array.from(event.changedTouches).find(
          (t) => t.identifier === this.press?.pointer,
        );
        if (touch) this.end(touch.clientX, touch.clientY, event);
      },
      { capture: true, passive: false },
    );
    this.listen(this.doc, "touchcancel", () => this.cancel(), {
      capture: true,
    });
    this.listen(
      this.root,
      "dragstart",
      (e) => {
        if (this.press) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
    this.listen(
      this.root,
      "click",
      (e) => {
        if (Date.now() < this.suppressClickUntil || (e.target as Element).closest(".qt-handle")) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
    this.listen(
      this.root,
      "contextmenu",
      (e) => {
        if (
          this.press?.active ||
          (this.press?.input === "touch" && Date.now() - this.press.time > 150)
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
        } else this.cancel();
      },
      { capture: true },
    );
    this.listen(
      this.doc,
      "keydown",
      (e) => {
        const event = e as KeyboardEvent;
        if (event.key === "Escape" && this.press) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.cancel();
        }
      },
      { capture: true },
    );
    this.listen(this.root, "keydown", (e) => this.handleKey(e as KeyboardEvent));
    this.listen(this.win, "blur", () => this.cancel());
    this.listen(this.win, "resize", () => this.cancel());
    this.listen(this.doc, "visibilitychange", () => {
      if (this.doc.hidden) this.cancel();
    });
    this.listen(
      this.root,
      "scroll",
      () => {
        if (this.press && !this.press.active) this.cancel();
        this.picker = null;
        this.needsResolve = true;
      },
      { passive: true },
    );
    this.observer = new realm.MutationObserver((records) => {
      let changed = false;
      let structureChanged = false;
      for (const record of records) {
        const target = record.target as HTMLElement;
        if (record.type === "attributes") {
          // Our drag highlight must not invalidate its own geometry every frame.
          if (record.attributeName === "class") {
            const nativeClasses = (value: string) =>
              value
                .split(/\s+/)
                .filter((name) => name && !name.startsWith("qt-"))
                .join(" ");
            if (
              nativeClasses(record.oldValue ?? "") ===
              nativeClasses(target.getAttribute("class") ?? "")
            )
              continue;
            if (
              /(^|\s)is-collapsed(\s|$)/.test(record.oldValue ?? "") !==
              target.classList.contains("is-collapsed")
            )
              structureChanged = true;
          }
          if (target.closest?.(".qt-handle,.qt-hold-progress")) continue;
          changed = true;
          if (record.attributeName === "data-path") {
            this.pendingDecorations.add(target);
            structureChanged = true;
          }
        } else {
          for (const node of [...record.addedNodes, ...record.removedNodes]) {
            if (node.nodeType !== 1) {
              changed = true;
              continue;
            }
            const el = node as HTMLElement;
            if (el.matches(".qt-handle,.qt-hold-progress")) continue;
            changed = true;
            if (this.root.contains(el)) this.pendingDecorations.add(el);
          }
        }
      }
      if (!changed) return;
      this.invalidateGeometry();
      // Virtualized row mounting changes geometry, not the logical tree.
      this.snapshotDirty ||= structureChanged;
      if (this.pendingDecorations.size && !this.decorateFrame)
        this.decorateFrame = this.win.requestAnimationFrame(() => {
          this.decorateFrame = 0;
          const pending = [...this.pendingDecorations];
          this.pendingDecorations.clear();
          const ancestors = new Set(pending);
          for (const el of pending) {
            if (!this.root.contains(el)) continue;
            let parent = el.parentElement;
            let covered = false;
            while (parent && parent !== this.root) {
              if (ancestors.has(parent)) {
                covered = true;
                break;
              }
              parent = parent.parentElement;
            }
            if (covered) continue;
            this.decorate(el);
          }
        });
    });
    try {
      this.observer.observe(this.root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ["data-path", "class", "style"],
      });
      this.decorate();
    } catch (error) {
      this.destroy();
      throw error;
    }
  }
  private invalidateGeometry() {
    this.measuredRows = null;
    this.needsResolve = true;
  }
  private fault(error: unknown) {
    this.cancel();
    if (!this.failed) this.plugin.report(error, "compatibilityError");
    this.failed = true;
  }
  private listen(
    target: EventTarget,
    type: string,
    fn: EventListener,
    options?: AddEventListenerOptions,
  ) {
    const guarded: EventListener = (event) => {
      try {
        fn(event);
      } catch (error) {
        this.fault(error);
      }
    };
    target.addEventListener(type, guarded, options);
    this.disposers.push(() => target.removeEventListener(type, guarded, options));
  }
  decorate(scope: HTMLElement = this.root) {
    this.root.dataset.qtTrigger = this.plugin.settings.trigger;
    const selector = ".tree-item-self[data-path]";
    const rows = scope.matches(selector) ? [scope] : scope.querySelectorAll<HTMLElement>(selector);
    for (const el of rows) {
      const path = el.dataset.path!;
      const allowed =
        !this.view.searchQuery &&
        path !== "/" &&
        !excluded(parentPath(path), this.plugin.settings.excluded);
      let handle = el.querySelector<HTMLElement>(":scope > .qt-handle");
      el.classList.toggle("qt-sortable", allowed);
      if (!allowed || this.plugin.settings.trigger !== "handle") {
        handle?.remove();
        continue;
      }
      if (!handle) {
        handle = this.dom.createSpan();
        handle.className = "qt-handle";
        handle.setAttribute("role", "button");
        handle.tabIndex = 0;
        setIcon(handle, "grip-vertical");
        el.append(handle);
      }
      handle.setAttribute("aria-label", `${this.plugin.t("hold")}: ${path}`);
    }
  }
  private eligible(target: EventTarget | null): HTMLElement | null {
    if (this.failed || this.destroyed) return null;
    const element = target as Element | null;
    if (
      !element?.closest ||
      element.closest("input,textarea,[contenteditable=true],.collapse-icon")
    )
      return null;
    if (this.view.searchQuery) return null; // Filtered trees have ambiguous hidden siblings.
    const row = element.closest<HTMLElement>(".tree-item-self[data-path]");
    if (!row || !this.root.contains(row) || !row.classList.contains("qt-sortable")) return null;
    if (this.plugin.settings.trigger === "handle" && !element.closest(".qt-handle")) return null;
    return row;
  }
  private pointerDown(event: PointerEvent) {
    if (event.pointerType === "touch") {
      // Claim only a sortable drag target. Do not preventDefault: taps and
      // pre-activation scrolling must retain their browser defaults.
      if (this.eligible(event.target)) event.stopPropagation();
      return;
    }
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const row = this.eligible(event.target);
    if (row) this.begin(row, event.clientX, event.clientY, "mouse", event.pointerId);
  }
  private touchStart(event: TouchEvent) {
    if (event.touches.length !== 1) {
      this.cancel();
      return;
    }
    const row = this.eligible(event.target),
      touch = event.touches[0];
    if (row) {
      event.stopPropagation();
      this.begin(row, touch.clientX, touch.clientY, "touch", touch.identifier);
    }
  }
  private begin(el: HTMLElement, x: number, y: number, input: "mouse" | "touch", pointer: number) {
    this.cancel();
    this.press = {
      id: el.dataset.path!,
      el,
      input,
      startX: x,
      startY: y,
      x,
      y,
      time: Date.now(),
      active: false,
      pointer,
    };
    const delay = input === "touch" ? this.plugin.settings.delay : this.plugin.settings.mouseDelay;
    this.timer = this.win.setTimeout(() => {
      try {
        if (
          this.press &&
          (input === "touch" || Math.hypot(this.press.x - x, this.press.y - y) >= 4)
        )
          this.activate();
      } catch (error) {
        this.fault(error);
      }
    }, delay);
  }
  private activate() {
    const p = this.press;
    if (!p || p.active || !p.el.isConnected) return;
    const data = snapshot(this.plugin.app, this.view);
    if (this.press !== p) return;
    this.data = data;
    this.snapshotDirty = false;
    this.invalidateGeometry();
    this.themeObserver.observe(this.doc.body, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    if (!this.data.tree.nodes[p.id]) {
      this.cancel();
      return;
    }
    p.active = true;
    p.el.classList.add("qt-source");
    this.root.classList.add("qt-dragging");
    // A temporary hit surface prevents native hover/title tooltips without
    // modifying global tooltip behavior or another plugin's event handlers.
    try {
      this.view.onFilePointerout?.(
        new (this.win as Window & typeof window).PointerEvent("pointerout", {
          relatedTarget: this.root,
        }),
        p.el,
      );
    } catch (error) {
      console.warn("[Quiet Tree] Tooltip cleanup unavailable", error);
    }
    this.surface = this.dom.createDiv();
    this.surface.className = "qt-drag-surface";
    this.surface.setAttribute("aria-hidden", "true");
    this.surface.addEventListener("contextmenu", (event) => event.preventDefault());
    this.surface.addEventListener(
      "wheel",
      (event) => {
        const scale =
          event.deltaMode === 1 ? ROW : event.deltaMode === 2 ? this.root.clientHeight : 1;
        this.root.scrollTop += event.deltaY * scale;
        event.preventDefault();
      },
      { passive: false },
    );
    this.doc.body.append(this.surface);
    this.doc.getSelection()?.removeAllRanges();
    this.ghost = this.dom.createDiv();
    this.ghost.className = "qt-ghost";
    this.ghost.setAttribute("aria-hidden", "true");
    this.ghost.style.width = `${Math.min(280, Math.max(220, p.el.getBoundingClientRect().width))}px`;
    const card = this.dom.createDiv();
    card.className = "qt-ghost-card";
    const grip = this.dom.createSpan();
    grip.className = "qt-ghost-grip";
    setIcon(grip, "grip-vertical");
    const icon = this.dom.createSpan();
    icon.className = "qt-ghost-icon";
    setIcon(icon, this.data.tree.nodes[p.id].kind === "folder" ? "folder" : "file-text");
    const title = this.dom.createEl("strong");
    title.textContent = displayName(this.data.tree.nodes[p.id].name);
    const badge = this.dom.createSpan();
    badge.className = "qt-ghost-badge";
    badge.textContent = this.plugin.t("lifted");
    const header = this.dom.createDiv();
    header.className = "qt-ghost-row";
    header.append(grip, icon, title, badge);
    card.append(header);
    if (p.input === "mouse") {
      const hint = this.dom.createDiv();
      hint.className = "qt-ghost-cancel";
      const [before, after] = this.plugin.t("cancelWithKey").split("{key}");
      const key = this.dom.createEl("kbd");
      key.textContent = "Esc";
      hint.append(before, key, after);
      card.append(hint);
    } else {
      this.cancelZone = this.dom.createDiv();
      this.cancelZone.className = "qt-cancel-zone";
      this.cancelZone.setAttribute("role", "status");
      const icon = this.dom.createSpan();
      setIcon(icon, "x");
      const text = this.dom.createSpan();
      text.className = "qt-cancel-text";
      text.textContent = this.plugin.t("dragToCancel");
      this.cancelZone.append(icon, text);
      this.doc.body.append(this.cancelZone);
    }
    const label = this.dom.createSpan();
    label.className = "qt-ghost-label";
    label.hidden = true;
    this.ghost.append(card, label);
    this.doc.body.append(this.ghost);
    this.line = this.dom.createDiv();
    this.line.className = "qt-drop-line";
    this.doc.body.append(this.line);
    this.pickerEl = this.dom.createDiv();
    this.pickerEl.className = "qt-picker";
    this.pickerEl.hidden = true;
    this.doc.body.append(this.pickerEl);
    this.tick();
  }
  private move(x: number, y: number, event: Event) {
    const p = this.press;
    if (!p) return;
    p.x = x;
    p.y = y;
    this.needsResolve = true;
    const distance = Math.hypot(x - p.startX, y - p.startY);
    if (!p.active) {
      if (p.input === "touch" && distance > 8) {
        this.cancel();
        return;
      }
      if (
        p.input === "mouse" &&
        distance >= 4 &&
        Date.now() - p.time >= this.plugin.settings.mouseDelay
      )
        this.activate();
    }
    if (p.active) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
  private measured(bounds: DOMRect = this.root.getBoundingClientRect()): Measured[] {
    if (!this.data) return [];
    if (this.measuredRows && this.measuredOrigin.width === bounds.width) {
      const dx =
        bounds.left -
        this.measuredOrigin.left -
        (this.root.scrollLeft - this.measuredOrigin.scrollLeft);
      const dy =
        bounds.top -
        this.measuredOrigin.top -
        (this.root.scrollTop - this.measuredOrigin.scrollTop);
      if (!dx && !dy) return this.measuredRows;
      this.measuredRows = this.measuredRows.map((row) => ({
        ...row,
        rect: {
          ...row.rect,
          top: row.rect.top + dy,
          bottom: row.rect.bottom + dy,
          left: row.rect.left + dx,
          right: row.rect.right + dx,
        },
      }));
    } else {
      const indexes = new Map(this.data.rows.map((row, index) => [row.id, index]));
      this.measuredRows = Array.from(
        this.root.querySelectorAll<HTMLElement>(".tree-item-self[data-path]"),
      )
        .flatMap((el) => {
          const id = el.dataset.path!,
            index = indexes.get(id),
            rect = index === undefined ? null : el.getBoundingClientRect();
          return index !== undefined && rect && rect.height > 0
            ? [
                {
                  id,
                  index,
                  el,
                  rect: {
                    top: rect.top,
                    bottom: rect.bottom,
                    left: rect.left,
                    right: rect.right,
                    width: rect.width,
                    height: rect.height,
                  },
                },
              ]
            : [];
        })
        .sort((a, b) => a.index - b.index);
      const next = new Set<Element>([this.root, ...this.measuredRows.map((row) => row.el)]);
      for (const el of this.observedRows) if (!next.has(el)) this.resizeObserver.unobserve(el);
      for (const el of next) if (!this.observedRows.has(el)) this.resizeObserver.observe(el);
      this.observedRows = next;
    }
    this.measuredOrigin = {
      top: bounds.top,
      left: bounds.left,
      width: bounds.width,
      scrollTop: this.root.scrollTop,
      scrollLeft: this.root.scrollLeft,
    };
    return this.measuredRows;
  }
  private resolve() {
    if (this.snapshotDirty && this.press?.active) {
      const press = this.press;
      const data = snapshot(this.plugin.app, this.view);
      if (this.press !== press) return;
      this.data = data;
      this.snapshotDirty = false;
      this.invalidateGeometry();
    }

    const p = this.press,
      data = this.data;
    if (!p?.active || !data) return;
    const bounds = this.root.getBoundingClientRect();
    Object.assign(this.surface!.style, {
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
    });
    const measured = this.measured(bounds);
    this.cancelHovered =
      !!this.cancelZone && contains(this.cancelZone.getBoundingClientRect(), p.x, p.y);
    this.cancelZone?.classList.toggle("is-active", this.cancelHovered);
    const cancelText = this.cancelZone?.querySelector(".qt-cancel-text");
    if (cancelText) {
      const text = this.plugin.t(this.cancelHovered ? "releaseToCancel" : "dragToCancel");
      if (cancelText.textContent !== text) cancelText.textContent = text;
    }
    if (this.cancelHovered) {
      this.hit = emptyHit;
      this.picker = null;
      this.pickerKey = "";
      this.hoverId = "";
      this.paint(measured);
      return;
    }
    if (!measured.length) {
      this.hit = emptyHit;
      return;
    }
    let kept = false;
    if (this.picker && this.hit.band) {
      if (Math.hypot(p.x - this.picker.originX, p.y - this.picker.originY) > 6)
        this.picker.armed = true;
      const choice = pickerHit(
        this.picker,
        p.x,
        p.y,
        this.hit.candidates.length,
        this.hit.band.choice,
      );
      if (choice !== null) {
        kept = true;
        if (typeof choice === "number")
          this.hit = normalizeHit(data.tree, data.rows, p.id, {
            ...this.hit,
            target: this.hit.candidates[choice],
            band: { ...this.hit.band, choice },
          });
      } else {
        this.picker = null;
        this.pickerKey = "";
      }
    }
    if (!kept) {
      if (p.x < bounds.left || p.x > bounds.right || p.y < bounds.top || p.y > bounds.bottom) {
        this.hit = emptyHit;
        this.picker = null;
        this.pickerKey = "";
        this.paint(measured);
        return;
      }
      const closest = measured.reduce((best, row) =>
        Math.abs(p.y - (row.rect.top + row.rect.height / 2)) <
        Math.abs(p.y - (best.rect.top + best.rect.height / 2))
          ? row
          : best,
      );
      const logicalY = (closest.index + (p.y - closest.rect.top) / closest.rect.height) * ROW;
      this.hit = resolveTreeHit(
        data.tree,
        data.rows,
        p.id,
        ROW,
        p.x - bounds.left,
        logicalY,
        this.hit,
      );
      if (
        this.hit.target &&
        excluded(this.hit.target.parentId ?? "/", this.plugin.settings.excluded)
      )
        this.hit = { ...emptyHit, invalid: this.plugin.t("locked") };
      if (this.hit.band && this.hit.candidates.length > 1) {
        const key = `${this.hit.band.gap}:${this.hit.candidates.map(targetKey).join("|")}`;
        if (key !== this.pickerKey) {
          this.pickerKey = key;
          this.pickerSince = Date.now();
          this.picker = null;
        }
        if (!this.picker && Date.now() - this.pickerSince >= 240) {
          this.picker = makeBoundaryPicker(
            bounds,
            this.gapY(measured),
            this.hit.candidates.length,
            this.hit.band.choice,
            46,
            this.win.innerWidth,
            this.cancelZone
              ? this.cancelZone.getBoundingClientRect().top - 8
              : this.win.innerHeight,
            p.x,
            p.y,
            this.root.scrollTop,
          );
        }
      } else {
        this.pickerKey = "";
        this.picker = null;
      }
    }
    if (this.hit.target && excluded(this.hit.target.parentId ?? "/", this.plugin.settings.excluded))
      this.hit = {
        ...this.hit,
        target: null,
        invalid: this.plugin.t("locked"),
      };
    const folder = this.hit.target?.kind === "inside" ? (this.hit.target.parentId ?? "") : "";
    if (folder !== this.hoverId) {
      this.hoverId = folder;
      this.hoverSince = Date.now();
    }
    if (folder && Date.now() - this.hoverSince > 650) {
      const item = this.view.fileItems[folder];
      this.hoverSince = Infinity;
      if (item?.collapsed && item.setCollapsed) {
        void Promise.resolve(item.setCollapsed(false))
          .then(() => {
            if (this.press === p) {
              const data = snapshot(this.plugin.app, this.view);
              if (this.press !== p) return;
              this.data = data;
              this.invalidateGeometry();
              this.hit = emptyHit;
              this.picker = null;
            }
          })
          .catch((error) => this.fault(error));
      }
    }
    this.paint(measured);
  }
  private gapY(rows: Measured[]): number {
    const gap = this.hit.band?.gap ?? 0;
    const next = rows.find((row) => row.index === gap);
    if (next) return next.rect.top;
    const previous = rows.find((row) => row.index === gap - 1);
    return previous ? previous.rect.bottom : this.press!.y;
  }
  private paint(rows: Measured[]) {
    const p = this.press!;
    const bounds = this.root.getBoundingClientRect();
    const { width, height } = this.ghost!.getBoundingClientRect();
    const x = Math.max(
      8,
      Math.min(p.input === "touch" ? p.x - width / 2 : p.x + 16, this.win.innerWidth - width - 8),
    );
    let y = Math.max(
      8,
      Math.min(p.y + (p.input === "touch" ? -height - 24 : 14), this.win.innerHeight - height - 8),
    );
    // Keep the cancellation hint readable while the pointer enters the chooser.
    if (
      this.picker &&
      x < this.picker.left + this.picker.width &&
      x + width > this.picker.left &&
      y < this.picker.top + this.picker.height &&
      y + height > this.picker.top
    ) {
      const above = this.picker.top - height - 8;
      const below = this.picker.top + this.picker.height + 8;
      const bottom = this.cancelZone?.getBoundingClientRect().top ?? this.win.innerHeight;
      y =
        p.input === "touch" && above >= 8
          ? above
          : below + height <= bottom - 8
            ? below
            : Math.max(8, above);
    }
    this.ghost!.style.transform = `translate3d(${x}px,${y}px,0)`;
    // Position is shown on the tree. Only errors need an additional message.
    const text = this.hit.invalid ? this.plugin.t("invalid") : "";
    const label = this.ghost!.querySelector(".qt-ghost-label")!;
    if (label.textContent !== text) label.textContent = text;
    (label as HTMLElement).hidden = !text;
    const target = this.hit.target;
    const activeFolder =
      target?.kind === "inside" ? rows.find((row) => row.id === target.parentId)?.el : undefined;
    if (activeFolder !== this.activeFolder) {
      this.activeFolder?.classList.remove("qt-inside");
      this.activeFolder = activeFolder;
      this.activeFolder?.classList.add("qt-inside");
    }
    const lineY = this.gapY(rows);
    this.line!.hidden =
      !target ||
      (this.hit.noOp && !this.picker) ||
      target.kind === "inside" ||
      lineY < bounds.top ||
      lineY > bounds.bottom;
    if (target) {
      // Derive indentation from the live theme, rather than assuming 18 px steps.
      const parent = rows.find((row) => row.id === target.parentId);
      const sibling = rows.find(
        (row) => this.data!.tree.nodes[row.id].parentId === target.parentId,
      );
      const anchor = sibling?.el
        .querySelector<HTMLElement>(".tree-item-inner")
        ?.getBoundingClientRect();
      const parentAnchor = parent?.el
        .querySelector<HTMLElement>(".tree-item-inner")
        ?.getBoundingClientRect();
      const left = Math.max(
        bounds.left + 8,
        (anchor?.left ?? (parentAnchor?.left ?? bounds.left + 22) + 18) - 12,
      );
      this.line!.style.transform = `translate3d(${left}px,${lineY}px,0)`;
      this.line!.style.width = `${Math.max(20, bounds.right - left - 12)}px`;
    }
    this.pickerEl!.hidden = !this.picker;
    if (this.picker) {
      const picker = this.picker;
      Object.assign(this.pickerEl!.style, {
        left: `${picker.left}px`,
        top: `${picker.top}px`,
        width: `${picker.width}px`,
      });
      const key = this.hit.candidates.map(targetKey).join("|");
      if (this.pickerEl!.dataset.key !== key) {
        this.pickerEl!.dataset.key = key;
        this.pickerEl!.replaceChildren();
        const heading = this.dom.createDiv();
        heading.className = "qt-picker-heading";
        const headingIcon = this.dom.createSpan();
        setIcon(headingIcon, "layers");
        const headingTitle = this.dom.createSpan();
        headingTitle.textContent = this.plugin.t("choose");
        const hint = this.dom.createEl("small");
        hint.textContent = this.plugin.t("chooseHint");
        heading.append(headingIcon, headingTitle, hint);
        this.pickerEl!.append(heading);
        for (const candidate of this.hit.candidates) {
          const option = this.dom.createDiv();
          option.className = "qt-picker-option";
          const description = destinationLabel(this.data!.tree, candidate, p.id, this.plugin.t);
          const icon = this.dom.createSpan();
          icon.className = "qt-picker-icon";
          setIcon(icon, "corner-down-right");
          const text = this.dom.createDiv();
          text.className = "qt-picker-text";
          const name = this.dom.createEl("strong");
          name.textContent = description.directory;
          name.title = description.path;
          const position = this.dom.createSpan();
          position.textContent = isNoopMove(this.data!.tree, p.id, candidate)
            ? this.plugin.t("unchanged")
            : description.position;
          text.append(name, position);
          const check = this.dom.createSpan();
          check.className = "qt-picker-check";
          setIcon(check, "check");
          option.append(icon, text, check);
          this.pickerEl!.append(option);
        }
      }
      Array.from(this.pickerEl!.querySelectorAll(".qt-picker-option")).forEach((option, index) =>
        option.classList.toggle("is-selected", index === this.hit.band?.choice),
      );
    }
  }
  private tick = () => {
    if (!this.press?.active) return;
    try {
      const rect = this.root.getBoundingClientRect(),
        p = this.press;
      const boundsKey = `${rect.top}:${rect.left}:${rect.width}:${rect.height}:${this.root.scrollTop}:${this.root.scrollLeft}`;
      if (boundsKey !== this.lastBounds) this.needsResolve = true;
      this.lastBounds = boundsKey;
      const now = Date.now();
      if (
        this.needsResolve ||
        (this.pickerKey && !this.picker && now - this.pickerSince >= 240) ||
        (this.hoverId && now - this.hoverSince > 650)
      ) {
        this.needsResolve = false;
        this.resolve();
        if (this.press !== p) return;
      }
      if (
        !this.picker &&
        !this.cancelHovered &&
        p.x >= rect.left &&
        p.x <= rect.right &&
        p.y >= rect.top &&
        p.y <= rect.bottom
      ) {
        const edge = 40;
        const bottom = Math.min(
          rect.bottom,
          this.cancelZone ? this.cancelZone.getBoundingClientRect().top - 12 : rect.bottom,
        );
        const delta =
          p.y < rect.top + edge
            ? -Math.min(9, (rect.top + edge - p.y) / 4)
            : p.y > bottom - edge
              ? Math.min(9, (p.y - bottom + edge) / 4)
              : 0;
        if (delta) this.root.scrollTop += delta;
      }
      this.frame = this.win.requestAnimationFrame(this.tick);
    } catch (error) {
      this.fault(error);
    }
  };
  private end(x: number, y: number, event: Event) {
    const p = this.press;
    if (!p) return;
    if (p.active) {
      event.preventDefault();
      event.stopImmediatePropagation();
      p.x = x;
      p.y = y;
      this.snapshotDirty = true;
      this.invalidateGeometry(); // Recheck live layout before committing a drop.
      this.resolve(); // Commit the release coordinates, not the previous frame.
      if (this.press !== p) return;
      const target = this.hit.target,
        noOp = this.hit.noOp;
      this.cancel();
      if (target && !noOp) void this.plugin.move(this.view, p.id, target);
    } else this.cancel();
  }
  private handleKey(event: KeyboardEvent) {
    if (
      !(event.target as Element).closest(".qt-handle") ||
      !["ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    const row = (event.target as Element).closest<HTMLElement>("[data-path]");
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    const data = snapshot(this.plugin.app, this.view),
      id = row.dataset.path!,
      node = data.tree.nodes[id];
    if (!node) return;
    const ids = node.parentId ? data.tree.nodes[node.parentId].children : data.tree.roots,
      index = ids.indexOf(id);
    if (
      (event.key === "ArrowUp" && index === 0) ||
      (event.key === "ArrowDown" && index === ids.length - 1)
    )
      return;
    void this.plugin.move(this.view, id, {
      parentId: node.parentId,
      beforeId: event.key === "ArrowUp" ? ids[index - 1] : (ids[index + 2] ?? null),
      depth: 0,
      kind: "insert",
    });
  }
  cancel() {
    if (this.press?.active) this.suppressClickUntil = Date.now() + 500;
    this.win.clearTimeout(this.timer);
    this.win.cancelAnimationFrame(this.frame);
    this.press?.el.classList.remove("qt-source");
    this.activeFolder?.classList.remove("qt-inside");
    this.activeFolder = undefined;
    this.root.classList.remove("qt-dragging");
    this.surface?.remove();
    this.surface = undefined;
    this.cancelZone?.remove();
    this.cancelZone = undefined;
    this.cancelHovered = false;
    this.ghost?.remove();
    this.line?.remove();
    this.pickerEl?.remove();
    this.ghost = this.line = this.pickerEl = undefined;
    this.press = null;
    this.data = null;
    this.resizeObserver.disconnect();
    this.themeObserver.disconnect();
    this.observedRows.clear();
    this.measuredRows = null;
    this.snapshotDirty = false;
    this.lastBounds = "";
    this.hit = emptyHit;
    this.picker = null;
    this.pickerKey = "";
    this.hoverId = "";
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancel();
    this.observer.disconnect();
    this.win.cancelAnimationFrame(this.decorateFrame);
    this.disposers.forEach((fn) => fn());
    this.root.querySelectorAll(".qt-handle").forEach((handle) => handle.remove());
    this.root
      .querySelectorAll(".qt-sortable")
      .forEach((row) => row.classList.remove("qt-sortable"));
    this.root.classList.remove("qt-explorer");
    delete this.root.dataset.qtTrigger;
  }
}
