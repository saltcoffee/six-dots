import { describe, expect, it } from 'vitest';
import { fitPoint, intersect, toFixedPoint, viewportBounds } from '../src/editor/viewport';

describe('visible editor geometry', () => {
  it('keeps iOS DOM and pointer coordinates in the visual viewport until fixed positioning', () => {
    const win = { innerWidth: 800, innerHeight: 900, visualViewport: { offsetLeft: 10, offsetTop: 120, width: 380, height: 300 } } as Window;
    const bounds = viewportBounds(win, true);
    expect(bounds).toEqual({ left: 0, top: 0, right: 380, bottom: 300 });
    expect(intersect({ left: 0, top: 50, right: 800, bottom: 800 }, bounds))
      .toEqual({ left: 0, top: 50, right: 380, bottom: 300 });
    const client = fitPoint(bounds, 328, 299, 44, 44);
    expect(client).toEqual({ x: 328, y: 256 });
    expect(toFixedPoint(win, client, true)).toEqual({ x: 338, y: 376 });
  });
  it('does not add a second offset on Chromium or when iOS has no visual viewport', () => {
    const win = { innerWidth: 800, innerHeight: 900, visualViewport: { offsetLeft: 10, offsetTop: 120, width: 380, height: 300 } } as Window;
    expect(toFixedPoint(win, { x: 20, y: 130 })).toEqual({ x: 20, y: 130 });
    const fallback = { innerWidth: 400, innerHeight: 700, visualViewport: null };
    expect(viewportBounds(fallback, true)).toEqual({ left: 0, top: 0, right: 400, bottom: 700 });
    expect(toFixedPoint(fallback, { x: 20, y: 30 }, true)).toEqual({ x: 20, y: 30 });
  });
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
