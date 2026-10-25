export interface Bounds { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
export interface Point { readonly x: number; readonly y: number }
type ViewportWindow = Pick<Window, 'innerWidth' | 'innerHeight' | 'visualViewport'>;

/** Match raw DOM/CodeMirror/pointer coordinates: iOS WebKit uses the visual viewport. */
export function viewportBounds(win: ViewportWindow, ios = false): Bounds {
  const viewport = win.visualViewport;
  const left = ios ? 0 : viewport?.offsetLeft ?? 0, top = ios ? 0 : viewport?.offsetTop ?? 0;
  return { left, top, right: left + (viewport?.width ?? win.innerWidth), bottom: top + (viewport?.height ?? win.innerHeight) };
}

/** CSS fixed offsets use the layout viewport, unlike raw client coordinates on iOS.
 * See floating-ui/floating-ui, packages/dom/src/utils/getVisualOffsets.ts.
 */
export function toFixedPoint(win: ViewportWindow, point: Point, ios = false): Point {
  const viewport = ios ? win.visualViewport : null;
  return { x: point.x + (viewport?.offsetLeft ?? 0), y: point.y + (viewport?.offsetTop ?? 0) };
}

export function intersect(a: Bounds, b: Bounds): Bounds | null {
  const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right), bottom = Math.min(a.bottom, b.bottom);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

export function fitPoint(bounds: Bounds, x: number, y: number, width: number, height: number): Point {
  return {
    x: Math.max(bounds.left, Math.min(x, bounds.right - width)),
    y: Math.max(bounds.top, Math.min(y, bounds.bottom - height)),
  };
}
