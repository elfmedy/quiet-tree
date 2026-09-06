/** The tree's hit coordinates never depend on a drop indicator or an animation. */
export type GapBand = { gap: number; count: number; choice: number };
export function rowTop(index: number, rowHeight: number): number {
  return index * rowHeight;
}

/** Schmitt-style boundary: small motion around a midpoint retains the last gap. */
export function nearestGap(
  y: number,
  rowHeight: number,
  count: number,
  previous: number | null,
): number {
  if (
    previous !== null &&
    Math.abs(y - previous * rowHeight) <= rowHeight / 2 + 5
  )
    return previous;
  return Math.max(0, Math.min(count, Math.round(y / rowHeight)));
}
export type Rect = { left: number; top: number; width: number; height: number };
export type BoundaryPicker = Rect & {
  originX: number;
  originY: number;
  header: number;
  slotHeight: number;
  scrollTop: number;
  side: 'right' | 'below';
  armed: boolean;
};
export function makeBoundaryPicker(
  rect: Rect,
  anchorY: number,
  count: number,
  choice: number,
  slotHeight: number,
  screenWidth: number,
  screenHeight: number,
  originX: number,
  originY: number,
  scrollTop: number,
): BoundaryPicker {
  const width = Math.min(252, Math.max(190, rect.width - 32), screenWidth - 16);
  const side =
    rect.left + rect.width + 12 + width <= screenWidth - 8 ? 'right' : 'below';
  const header = 30,
    height = header + count * slotHeight;
  const left =
    side === 'right'
      ? rect.left + rect.width + 10
      : Math.max(
          8,
          Math.min(
            screenWidth - width - 8,
            rect.left + rect.width - width - 10,
          ),
        );
  const desiredTop =
    side === 'right'
      ? anchorY - header - (choice + 0.5) * slotHeight
      : anchorY + 14;
  const top = Math.max(8, Math.min(screenHeight - height - 8, desiredTop));
  return {
    left,
    top,
    width,
    height,
    header,
    slotHeight,
    originX,
    originY,
    scrollTop,
    side,
    armed: false,
  };
}
export function contains(
  rect: Rect,
  x: number,
  y: number,
  padding = 0,
): boolean {
  return (
    x >= rect.left - padding &&
    x <= rect.left + rect.width + padding &&
    y >= rect.top - padding &&
    y <= rect.top + rect.height + padding
  );
}
/** A narrow bridge makes the chooser reachable without changing the tree target. */
export function pickerHit(
  picker: BoundaryPicker,
  x: number,
  y: number,
  count: number,
  previousChoice: number,
): number | 'bridge' | null {
  if (contains(picker, x, y, 4)) {
    if (!picker.armed || y < picker.top + picker.header) return 'bridge';
    const local = y - picker.top - picker.header;
    if (
      local >= previousChoice * picker.slotHeight - 5 &&
      local <= (previousChoice + 1) * picker.slotHeight + 5
    )
      return previousChoice;
    return Math.max(
      0,
      Math.min(count - 1, Math.floor(local / picker.slotHeight)),
    );
  }
  const endX =
    picker.side === 'right'
      ? picker.left
      : Math.max(
          picker.left,
          Math.min(picker.left + picker.width, picker.originX),
        );
  const endY = picker.side === 'right' ? picker.originY : picker.top;
  if (
    picker.side === 'right' &&
    x >= picker.originX - 8 &&
    x <= picker.left + 4
  ) {
    const progress = Math.max(
      0,
      Math.min(
        1,
        (x - picker.originX) / Math.max(1, picker.left - picker.originX),
      ),
    );
    const top = picker.originY + (picker.top - picker.originY) * progress - 8;
    const bottom =
      picker.originY +
      (picker.top + picker.height - picker.originY) * progress +
      8;
    if (y >= top && y <= bottom) return 'bridge';
  }
  const bridge = {
    left: Math.min(picker.originX, endX) - 8,
    top: Math.min(picker.originY, endY) - 8,
    width: Math.abs(picker.originX - endX) + 16,
    height: Math.abs(picker.originY - endY) + 16,
  };
  return contains(bridge, x, y) ? 'bridge' : null;
}
export type PressPhase = 'pending' | 'dragging' | 'cancelled';
export function pressIntent(
  input: 'mouse' | 'touch',
  elapsed: number,
  distance: number,
  delay: number,
): PressPhase {
  if (input === 'touch' && distance > 8) return 'cancelled';
  return elapsed >= delay && (input === 'touch' || distance >= 4)
    ? 'dragging'
    : 'pending';
}
