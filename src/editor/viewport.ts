export interface Bounds { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

/** Client coordinates use the layout viewport; the keyboard can shrink only its visible part. */
export function viewportBounds(win: Pick<Window, 'innerWidth' | 'innerHeight' | 'visualViewport'>): Bounds {
  const viewport = win.visualViewport;
  const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
  return { left, top, right: left + (viewport?.width ?? win.innerWidth), bottom: top + (viewport?.height ?? win.innerHeight) };
}

export function intersect(a: Bounds, b: Bounds): Bounds | null {
  const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right), bottom = Math.min(a.bottom, b.bottom);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

export function fitPoint(bounds: Bounds, x: number, y: number, width: number, height: number): { x: number; y: number } {
  return {
    x: Math.max(bounds.left, Math.min(x, bounds.right - width)),
    y: Math.max(bounds.top, Math.min(y, bounds.bottom - height)),
  };
}
