import { describe, expect, it } from 'vitest';
import { fitPoint, intersect, viewportBounds } from '../src/editor/viewport';

describe('visible editor geometry', () => {
  it('uses the visual viewport when the keyboard leaves the layout viewport unchanged', () => {
    const win = { innerWidth: 800, innerHeight: 900, visualViewport: { offsetLeft: 10, offsetTop: 120, width: 380, height: 300 } } as Window;
    expect(viewportBounds(win)).toEqual({ left: 10, top: 120, right: 390, bottom: 420 });
    expect(intersect({ left: 0, top: 50, right: 800, bottom: 800 }, viewportBounds(win)))
      .toEqual({ left: 10, top: 120, right: 390, bottom: 420 });
  });
  it('falls back to the window on hosts without visualViewport', () => {
    expect(viewportBounds({ innerWidth: 400, innerHeight: 700, visualViewport: null }))
      .toEqual({ left: 0, top: 0, right: 400, bottom: 700 });
  });
  it('hides an editor that does not intersect the visible viewport', () => {
    expect(intersect({ left: 0, top: 400, right: 400, bottom: 800 }, { left: 0, top: 0, right: 400, bottom: 300 })).toBeNull();
  });
  it('fits handles and previews inside a narrow viewport with a non-zero offset', () => {
    const bounds = { left: 10, top: 100, right: 330, bottom: 400 };
    expect(fitPoint(bounds, 328, 399, 44, 44)).toEqual({ x: 286, y: 356 });
    expect(fitPoint(bounds, -100, 0, 280, 60)).toEqual({ x: 10, y: 100 });
  });
});
