import { setIcon } from "obsidian";
import { emptyHit, normalizeHit, resolveTreeHit, type DragHit } from "../lib/drag-hit-test";
import { makeBoundaryPicker, pickerHit, type BoundaryPicker } from "../lib/drag-geometry";
import { targetKey } from "../lib/explorer-model";
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
type Measured = { id: string; index: number; el: HTMLElement; rect: DOMRect };
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
  private guide?: HTMLElement;
  private surface?: HTMLElement;
  private progress?: HTMLElement;
  private pickerEl?: HTMLElement;
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
  constructor(
    private plugin: QuietTreePlugin,
    private view: NativeExplorer,
  ) {
    this.root = view.navFileContainerEl;
    this.doc = this.root.ownerDocument;
    this.win = this.doc.defaultView!;
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
      },
      { passive: true },
    );
    this.observer = new MutationObserver(() => {
      if (!this.decorateFrame)
        this.decorateFrame = this.win.requestAnimationFrame(() => {
          this.decorateFrame = 0;
          this.decorate();
        });
    });
    this.observer.observe(this.root, { childList: true, subtree: true });
    this.decorate();
  }
  private listen(
    target: EventTarget,
    type: string,
    fn: EventListener,
    options?: AddEventListenerOptions,
  ) {
    target.addEventListener(type, fn, options);
    this.disposers.push(() => target.removeEventListener(type, fn, options));
  }
  decorate() {
    this.root.dataset.qtTrigger = this.plugin.settings.trigger;
    for (const el of this.root.querySelectorAll<HTMLElement>(".tree-item-self[data-path]")) {
      const path = el.dataset.path!;
      const allowed =
        !this.view.searchQuery &&
        path !== "/" &&
        !excluded(parentPath(path), this.plugin.settings.excluded) &&
        path !== this.plugin.settings.jsonPath;
      let handle = el.querySelector<HTMLElement>(":scope > .qt-handle");
      el.classList.toggle("qt-sortable", allowed);
      if (!allowed) {
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
    const element = target as Element | null;
    if (
      !element?.closest ||
      element.closest("input,textarea,[contenteditable=true],.collapse-icon")
    )
      return null;
    if (this.view.searchQuery) return null; // Filtered trees have ambiguous hidden siblings.
    const row = element.closest<HTMLElement>(".tree-item-self[data-path]");
    if (!row || !this.root.contains(row) || !row.querySelector(":scope > .qt-handle")) return null;
    if (this.plugin.settings.trigger === "handle" && !element.closest(".qt-handle")) return null;
    return row;
  }
  private pointerDown(event: PointerEvent) {
    if (
      event.pointerType === "touch" ||
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
    if (row) this.begin(row, touch.clientX, touch.clientY, "touch", touch.identifier);
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
    const delay =
      input === "touch"
        ? this.plugin.settings.delay
        : Math.max(180, this.plugin.settings.delay * 0.52);
    el.style.setProperty("--qt-delay", `${delay}ms`);
    this.progress = this.dom.createSpan();
    this.progress.className = "qt-hold-progress";
    this.progress.setAttribute("aria-hidden", "true");
    el.append(this.progress);
    el.classList.add("qt-pressing");
    this.timer = this.win.setTimeout(() => {
      if (this.press && (input === "touch" || Math.hypot(this.press.x - x, this.press.y - y) >= 4))
        this.activate();
    }, delay);
  }
  private activate() {
    const p = this.press;
    if (!p || p.active || !p.el.isConnected) return;
    this.data = snapshot(this.plugin.app, this.view);
    if (!this.data.tree.nodes[p.id]) {
      this.cancel();
      return;
    }
    p.active = true;
    this.progress?.remove();
    this.progress = undefined;
    p.el.classList.remove("qt-pressing");
    p.el.classList.add("qt-source");
    this.root.classList.add("qt-dragging");
    // A temporary hit surface prevents native hover/title tooltips without
    // modifying global tooltip behavior or another plugin's event handlers.
    this.view.onFilePointerout?.(
      new PointerEvent("pointerout", { relatedTarget: this.root }),
      p.el,
    );
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
    card.append(grip, icon, title, badge);
    const label = this.dom.createSpan();
    label.className = "qt-ghost-label";
    label.hidden = true;
    this.ghost.append(card, label);
    this.doc.body.append(this.ghost);
    this.line = this.dom.createDiv();
    this.line.className = "qt-drop-line";
    this.doc.body.append(this.line);
    this.guide = this.dom.createDiv();
    this.guide.className = "qt-parent-guide";
    this.guide.setAttribute("aria-hidden", "true");
    this.doc.body.append(this.guide);
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
    const distance = Math.hypot(x - p.startX, y - p.startY);
    if (!p.active) {
      if (p.input === "touch" && distance > 8) {
        this.cancel();
        return;
      }
      if (
        p.input === "mouse" &&
        distance >= 4 &&
        Date.now() - p.time >= Math.max(180, this.plugin.settings.delay * 0.52)
      )
        this.activate();
    }
    if (p.active) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
  private measured(): Measured[] {
    if (!this.data) return [];
    const indexes = new Map(this.data.rows.map((row, index) => [row.id, index]));
    return Array.from(this.root.querySelectorAll<HTMLElement>(".tree-item-self[data-path]"))
      .flatMap((el) => {
        const id = el.dataset.path!,
          index = indexes.get(id),
          rect = el.getBoundingClientRect();
        return index !== undefined && rect.height > 0 ? [{ id, index, el, rect }] : [];
      })
      .sort((a, b) => a.index - b.index);
  }
  private resolve() {
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
    const measured = this.measured();
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
            this.win.innerHeight,
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
      if (item?.collapsed && item.setCollapsed) {
        this.hoverSince = Infinity;
        void item.setCollapsed(false).then(() => {
          if (this.press === p) {
            this.data = snapshot(this.plugin.app, this.view);
            this.hit = emptyHit;
            this.picker = null;
          }
        });
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
    const width = this.ghost!.getBoundingClientRect().width;
    const x = Math.max(
      8,
      Math.min(p.input === "touch" ? p.x - width / 2 : p.x + 16, this.win.innerWidth - width - 8),
    );
    const y = Math.max(
      8,
      Math.min(p.y + (p.input === "touch" ? -64 : 14), this.win.innerHeight - 76),
    );
    this.ghost!.style.transform = `translate3d(${x}px,${y}px,0)`;
    // Position is shown on the tree. Only errors need an additional message.
    const text = this.hit.invalid ? this.plugin.t("invalid") : "";
    const label = this.ghost!.querySelector(".qt-ghost-label")!;
    if (label.textContent !== text) label.textContent = text;
    (label as HTMLElement).hidden = !text;
    this.activeFolder?.classList.remove("qt-inside");
    this.activeFolder = undefined;
    const target = this.hit.target;
    const lineY = this.gapY(rows);
    this.line!.hidden =
      !target ||
      this.hit.noOp ||
      target.kind === "inside" ||
      lineY < bounds.top ||
      lineY > bounds.bottom;
    this.guide!.hidden = true;
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
      if (!this.line!.hidden && target.parentId) {
        const top = Math.max(
          bounds.top,
          parent?.rect.bottom ??
            rows.find((row) => row.rect.bottom > bounds.top)?.rect.top ??
            bounds.top,
        );
        const descendants = rows.filter((row) => row.id.startsWith(target.parentId! + "/"));
        const bottom = Math.min(bounds.bottom, descendants.at(-1)?.rect.bottom ?? lineY);
        this.guide!.hidden = top >= bottom;
        Object.assign(this.guide!.style, {
          left: `${left}px`,
          top: `${top}px`,
          height: `${Math.max(0, bottom - top)}px`,
        });
      }
      if (target.kind === "inside") {
        this.activeFolder = rows.find((row) => row.id === target.parentId)?.el;
        this.activeFolder?.classList.add("qt-inside");
      }
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
          position.textContent = description.position;
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
    this.resolve();
    const rect = this.root.getBoundingClientRect(),
      p = this.press;
    if (
      !this.picker &&
      p.x >= rect.left &&
      p.x <= rect.right &&
      p.y >= rect.top &&
      p.y <= rect.bottom
    ) {
      const edge = 40;
      const delta =
        p.y < rect.top + edge
          ? -Math.min(9, (rect.top + edge - p.y) / 4)
          : p.y > rect.bottom - edge
            ? Math.min(9, (p.y - rect.bottom + edge) / 4)
            : 0;
      if (delta) this.root.scrollTop += delta;
    }
    this.frame = this.win.requestAnimationFrame(this.tick);
  };
  private end(x: number, y: number, event: Event) {
    const p = this.press;
    if (!p) return;
    if (p.active) {
      event.preventDefault();
      event.stopImmediatePropagation();
      p.x = x;
      p.y = y;
      this.resolve(); // Commit the release coordinates, not the previous frame.
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
    this.press?.el.classList.remove("qt-pressing", "qt-source");
    this.press?.el.style.removeProperty("--qt-delay");
    this.progress?.remove();
    this.progress = undefined;
    this.activeFolder?.classList.remove("qt-inside");
    this.activeFolder = undefined;
    this.root.classList.remove("qt-dragging");
    this.surface?.remove();
    this.surface = undefined;
    this.guide?.remove();
    this.guide = undefined;
    this.ghost?.remove();
    this.line?.remove();
    this.pickerEl?.remove();
    this.ghost = this.line = this.pickerEl = undefined;
    this.press = null;
    this.data = null;
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
