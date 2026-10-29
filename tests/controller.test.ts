import { setup } from './helpers/controller';
import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { editorExtension } from '../src/editor/controller';
import type { Actions } from '../src/obsidian/actions';

describe('handle layout lifecycle', () => {
  it('keeps the hovered handle usable after clicking to place the cursor', async () => {
    const editor = setup();
    await vi.runAllTimersAsync();
    editor.hover(8);
    editor.measure();
    expect(editor.button.hidden).toBe(false);

    expect(() => editor.update({ selection: { anchor: 2 } }, true)).not.toThrow();
    editor.measure();
    expect(editor.button.hidden).toBe(false);
    editor.controller.openMenu();
    expect(editor.showMenu.mock.calls[0]?.[1].block.text).toBe('beta');
  });

  it('restores the handle after typing and preparing a fresh snapshot', async () => {
    const editor = setup();
    await vi.runAllTimersAsync();
    editor.hover();
    editor.measure();
    editor.update({ changes: { from: 1, insert: '!' }, selection: { anchor: 2 } });
    expect(editor.button.hidden).toBe(true);
    await vi.runAllTimersAsync();
    editor.measure();
    expect(editor.button.hidden).toBe(false);
    editor.controller.openMenu();
    expect(editor.showMenu.mock.calls[0]?.[1].block.text).toBe('a!lpha');
  });

  it('resolves the hovered block again after the viewport changes', async () => {
    const editor = setup();
    await vi.runAllTimersAsync();
    editor.hover();
    editor.measure();
    editor.pointAt(8);
    editor.update({}, true);
    editor.measure();
    expect(editor.button.hidden).toBe(false);
    expect(editor.button.style.top).toBe('58px');
    editor.controller.openMenu();
    expect(editor.showMenu.mock.calls[0]?.[1].block.text).toBe('beta');
  });

  it.each(['hover', 'cursor'] as const)('hides for a text selection and recovers for a caret in %s mode', async mode => {
    const editor = setup(mode);
    await vi.runAllTimersAsync();
    editor.hover();
    editor.measure();
    editor.update({ selection: { anchor: 0, head: 3 } });
    editor.measure();
    expect(editor.button.hidden).toBe(true);
    editor.update({ selection: { anchor: 8 } });
    editor.measure();
    expect(editor.button.hidden).toBe(false);
    expect(editor.button.style.top).toBe(mode === 'cursor' ? '58px' : '18px');
  });
});

describe('table interaction boundary', () => {
  describe.each([
    { container: 'root', text: 'parent\n\n| a | b |\n|---|---|\n|x|y|\n\nafter' },
    { container: 'quote', text: '> parent\n>\n> | a | b |\n> |---|---|\n> |x|y|\n>\n> after' },
    { container: 'callout', text: '> [!note] parent\n>\n> | a | b |\n> |---|---|\n> |x|y|\n>\n> after' },
    { container: 'CRLF callout', text: '> [!note] parent\r\n>\r\n> | a | b |\r\n> |---|---|\r\n> |x|y|\r\n>\r\n> after' },
    { container: 'list item', text: '- parent\n\n  | a | b |\n  |---|---|\n  |x|y|\n\n  after' },
  ])('raw Markdown tables in $container', ({ container, text }) => {
    it.each(['hover', 'cursor', 'mobile'] as const)('protects table positions and restores parent actions in %s mode', async mode => {
      const editor = setup(mode === 'cursor' ? 'cursor' : 'hover', mode === 'mobile');
      const parent = text.indexOf('parent');
      editor.update({ changes: { from: 0, to: editor.host.state.doc.length, insert: text }, selection: { anchor: parent } });
      await vi.runAllTimersAsync(); editor.hover(parent); editor.measure();
      // CodeMirror normalizes line endings; hit tests use its document offsets.
      const source = editor.host.state.doc.toString();
      expect(editor.button.hidden).toBe(false);
      const target = editor.controller.peek()!;
      expect(target).not.toBeNull();
      const cell = source.indexOf('x');
      editor.update({ selection: { anchor: cell } }); editor.hover(cell); editor.measure();
      editor.host.scrollDOM.dispatchEvent(new Event('scroll')); editor.measure();
      editor.viewport.dispatchEvent(new Event('resize')); editor.measure();
      expect(editor.button.hidden).toBe(true);
      expect(editor.controller.peek()).toBeNull();
      editor.controller.openMenu(); editor.controller.openMenu(true);
      expect(editor.showMenu).not.toHaveBeenCalled();
      const after = source.indexOf('after');
      editor.update({ selection: { anchor: after } }); editor.hover(after); editor.measure();
      expect(editor.button.hidden).toBe(false);
      const afterTarget = editor.controller.peek();
      expect(afterTarget?.block.text).toContain('after');
      if (container !== 'root') expect(afterTarget?.block).toBe(target.block);
      editor.controller.openMenu();
      expect(editor.showMenu.mock.calls[0]?.[1].block).toBe(afterTarget?.block);
    });
  });

  it('does not add a handle or editor track to a nested table cell editor', async () => {
    const editor = setup('cursor');
    editor.host.dom.closest.mockReturnValue(editor.table() as unknown as Element);
    await vi.runAllTimersAsync(); editor.measure();
    expect(editor.button.hidden).toBe(true);
    expect(editor.controller.peek()).toBeNull();
    editor.controller.openMenu(true);
    expect(editor.showMenu).not.toHaveBeenCalled();

    const state = EditorState.create({ extensions: [editorExtension({} as Actions, new Map())] });
    const attributes = state.facet(EditorView.editorAttributes)[0]!;
    expect(typeof attributes === 'function' ? attributes(editor.host as unknown as EditorView) : attributes).toBeNull();
  });

  it.each(['hover', 'cursor', 'mobile'] as const)('clears the previous target on table entry in %s mode', async mode => {
    const editor = setup(mode === 'cursor' ? 'cursor' : 'hover', mode === 'mobile');
    await vi.runAllTimersAsync(); editor.hover(); editor.measure();
    expect(editor.button.hidden).toBe(false);

    const cell = editor.table();
    expect(editor.interact('pointerdown', cell).defaultPrevented).toBe(false);
    expect(editor.button.hidden).toBe(true);
    editor.controller.openMenu();
    expect(editor.showMenu).not.toHaveBeenCalled();

    editor.doc.activeElement = cell; editor.host.dom.contains.mockReturnValue(true);
    editor.interact('focusin', cell); editor.measure();
    editor.host.scrollDOM.dispatchEvent(new Event('scroll')); editor.measure();
    editor.viewport.dispatchEvent(new Event('resize')); editor.measure();
    expect(editor.button.hidden).toBe(true);
    expect(editor.controller.peek()).toBeNull();

    editor.doc.activeElement = null;
    editor.interact('focusin', editor.host.dom); editor.hover(8); editor.measure();
    expect(editor.button.hidden).toBe(false);
  });

  it('closes an old menu and cancels a pending hold without consuming native table events', async () => {
    const editor = setup('hover', true);
    await vi.runAllTimersAsync(); editor.measure();
    editor.controller.openMenu();
    const menu = editor.showMenu.mock.results[0]!.value;
    const cell = editor.table();
    expect(editor.interact('focusin', cell).defaultPrevented).toBe(false);
    expect(menu.hide).toHaveBeenCalledOnce();

    editor.interact('focusin', editor.host.dom); editor.measure();
    editor.pointer('pointerdown');
    editor.interact('pointerdown', cell);
    await vi.advanceTimersByTimeAsync(400); editor.pointer('pointerup');
    expect(editor.button.classList.add).not.toHaveBeenCalledWith('is-ready');
    expect(editor.showMenu).toHaveBeenCalledOnce();
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it('restores hover actions over normal text while a table cell still has the caret', async () => {
    const editor = setup();
    await vi.runAllTimersAsync();
    editor.doc.activeElement = editor.table(); editor.host.dom.contains.mockReturnValue(true);
    editor.interact('focusin', editor.doc.activeElement); editor.measure();
    expect(editor.button.hidden).toBe(true);
    expect(editor.controller.peek()).toBeNull();
    editor.hover(8); editor.measure();
    expect(editor.button.hidden).toBe(false);
    editor.controller.openMenu();
    expect(editor.showMenu.mock.calls[0]?.[1].block.text).toBe('beta');
  });

  it('does not suppress cursor actions because another editor is focused in a table', async () => {
    const editor = setup('cursor');
    editor.doc.activeElement = editor.table();
    await vi.runAllTimersAsync(); editor.measure();
    expect(editor.button.hidden).toBe(false);
    expect(editor.controller.peek()?.block.text).toBe('alpha');
  });

  it('ignores table hover and rechecks the DOM when scrolling moves a table under the pointer', async () => {
    const editor = setup();
    await vi.runAllTimersAsync(); editor.hover(); editor.measure();
    const cell = editor.table();
    editor.hover(8, cell); editor.measure();
    expect(editor.button.hidden).toBe(true);

    editor.hover(); editor.measure();
    expect(editor.button.hidden).toBe(false);
    // CodeMirror may map a rendered widget to nearby source text. The DOM still owns the hit.
    editor.doc.elementFromPoint.mockReturnValue(cell as unknown as Element);
    editor.host.scrollDOM.dispatchEvent(new Event('scroll')); editor.measure();
    expect(editor.button.hidden).toBe(true);
    editor.controller.openMenu();
    expect(editor.showMenu).not.toHaveBeenCalled();

    editor.doc.elementFromPoint.mockReturnValue(editor.host.dom as unknown as Element);
    editor.hover(8); editor.measure();
    expect(editor.button.hidden).toBe(false);
  });

  it('rejects a drop over a table cell even when source hit testing returns a nearby block', async () => {
    const editor = setup();
    await vi.runAllTimersAsync(); editor.hover(); editor.measure();
    editor.pointer('pointerdown', { pointerType: 'mouse' });
    editor.pointAt(10);
    editor.doc.elementFromPoint.mockReturnValue(editor.table() as unknown as Element);
    editor.pointer('pointermove', { pointerType: 'mouse', clientX: 80, clientY: 90 });
    await vi.advanceTimersByTimeAsync(16);
    expect(editor.indicator.hidden).toBe(true);
    editor.pointer('pointerup', { pointerType: 'mouse', clientX: 80, clientY: 90 });
    expect(editor.apply).not.toHaveBeenCalled();
    expect(editor.host.state.doc.toString()).toBe('alpha\n\nbeta');
  });

  it.each([
    'alpha\n\n> parent\n>\n> | a | b |\n> |---|---|\n> |x|y|',
    'alpha\n\n> [!note] parent\n>\n> | a | b |\n> |---|---|\n> |x|y|',
    '- alpha\n- parent\n\n  | a | b |\n  |---|---|\n  |x|y|',
  ])('rejects a source-table drop without a rendered table DOM: %s', async text => {
    const editor = setup();
    editor.update({ changes: { from: 0, to: editor.host.state.doc.length, insert: text } });
    await vi.runAllTimersAsync(); editor.hover(); editor.measure();
    editor.pointer('pointerdown', { pointerType: 'mouse' }); editor.pointAt(text.indexOf('x'));
    editor.pointer('pointermove', { pointerType: 'mouse', clientX: 80, clientY: 90 });
    await vi.advanceTimersByTimeAsync(16);
    expect(editor.indicator.hidden).toBe(true);
    editor.pointer('pointerup', { pointerType: 'mouse', clientX: 80, clientY: 90 });
    expect(editor.apply).not.toHaveBeenCalled();
    expect(editor.host.state.doc.toString()).toBe(text);
  });
});

describe('mobile interaction', () => {
  it('hides the unfocused handle when a mobile menu is dismissed, then restores it on focus', async () => {
    const editor = setup('hover', true);
    await vi.runAllTimersAsync(); editor.measure();
    editor.controller.openMenu(); editor.measure();
    expect(editor.host.hasFocus).toBe(false);
    expect(editor.button.hidden).toBe(false);
    editor.showMenu.mock.results[0]!.value.hide(); editor.measure();
    expect(editor.button.hidden).toBe(true);
    expect(editor.button.setAttribute).toHaveBeenCalledWith('aria-expanded', 'false');
    editor.host.hasFocus = true; editor.host.dom.dispatchEvent(new Event('focusin')); editor.measure();
    expect(editor.button.hidden).toBe(false);
  });

  it('keeps the cursor handle when focus returns as the menu closes', async () => {
    const editor = setup('cursor', true);
    await vi.runAllTimersAsync(); editor.measure();
    editor.controller.openMenu(); editor.measure();
    editor.showMenu.mock.results[0]!.value.hide();
    editor.host.hasFocus = true; editor.measure();
    expect(editor.button.hidden).toBe(false);
  });

  it('positions the handle and drag overlays on iOS without offsetting raw drop hit tests', async () => {
    const editor = setup('hover', true, true);
    Object.assign(editor.viewport, { offsetLeft: 10, offsetTop: 120, width: 380, height: 300 });
    await vi.runAllTimersAsync(); editor.measure();
    expect(editor.button.hidden).toBe(false);
    expect(editor.button.style).toMatchObject({ left: '12px', top: '130px' });
    editor.pointer('pointerdown'); await vi.advanceTimersByTimeAsync(350);
    editor.pointAt(10); editor.pointer('pointermove', { clientX: 80, clientY: 90 });
    await vi.advanceTimersByTimeAsync(16);
    expect(editor.host.posAtCoords).toHaveBeenLastCalledWith({ x: 80, y: 90 });
    expect(editor.indicator.hidden).toBe(false);
    expect(editor.indicator.style).toMatchObject({ left: '58px', top: '200px' });
    expect(editor.preview.style).toMatchObject({ left: '106px', top: '222px' });
    editor.pointer('pointerup', { clientX: 80, clientY: 90 });
    expect(editor.apply).toHaveBeenCalledOnce();
    expect(editor.apply.mock.calls[0]?.[2].edits[0].insert).toBe('beta\n\nalpha');
  });

  it('keeps the track in CodeMirror-managed attributes across focus and selection updates', () => {
    const editor = setup('hover', true);
    editor.host.state = EditorState.create({ doc: 'alpha', extensions: [editorInfoField, editorExtension({} as Actions, new Map())] });
    for (const position of [0, 2]) {
      editor.host.state = editor.host.state.update({ selection: { anchor: position } }).state;
      const source = editor.host.state.facet(EditorView.editorAttributes)[0]!;
      expect(typeof source === 'function' ? source(editor.host as unknown as EditorView) : source)
        .toEqual({ class: 'six-dots-editor six-dots-touch-editor' });
    }
  });
  it('follows the caret even when a synced desktop setting uses hover', async () => {
    const editor = setup('hover', true);
    await vi.runAllTimersAsync(); editor.measure();
    expect(editor.button.hidden).toBe(false);
    editor.update({ selection: { anchor: 8 } }); editor.measure();
    editor.controller.openMenu();
    expect(editor.showMenu.mock.calls[0]?.[1].block.text).toBe('beta');
    expect(editor.button.classList.toggle).toHaveBeenCalledWith('is-touch', true);
    expect(editor.host.contentDOM.blur).toHaveBeenCalledOnce();
    expect(editor.settings.handle).toBe('hover');
  });

  it('opens the menu on a quick tap without leaving a hold timer behind', async () => {
    const editor = setup('hover', true);
    await vi.runAllTimersAsync(); editor.measure();
    editor.pointer('pointerdown'); editor.pointer('pointerup');
    await vi.advanceTimersByTimeAsync(400);
    expect(editor.showMenu).toHaveBeenCalledOnce();
    expect(editor.apply).not.toHaveBeenCalled();
    expect(editor.button.classList.add).not.toHaveBeenCalledWith('is-ready');
  });

  it('isolates native touches on the handle while leaving document touches alone', () => {
    const editor = setup('hover', true);
    const handleTouch = new Event('touchstart', { cancelable: true });
    const bodyTouch = new Event('touchstart', { cancelable: true });
    editor.button.dispatchEvent(handleTouch); editor.doc.dispatchEvent(bodyTouch);
    expect(handleTouch.defaultPrevented).toBe(true); expect(bodyTouch.defaultPrevented).toBe(false);
  });

  it('cancels movement before a touch hold has armed', async () => {
    const editor = setup('hover', true);
    await vi.runAllTimersAsync(); editor.measure();
    editor.pointer('pointerdown'); editor.pointer('pointermove', { clientX: 80, clientY: 70 });
    await vi.advanceTimersByTimeAsync(400); editor.pointer('pointerup', { clientX: 80, clientY: 70 });
    expect(editor.showMenu).not.toHaveBeenCalled(); expect(editor.apply).not.toHaveBeenCalled();
    expect(editor.host.state.doc.toString()).toBe('alpha\n\nbeta');
  });

  it('allows a held touch to move a complete block once', async () => {
    const editor = setup('hover', true);
    await vi.runAllTimersAsync(); editor.measure();
    editor.pointer('pointerdown'); await vi.advanceTimersByTimeAsync(350);
    editor.pointAt(10); editor.pointer('pointermove', { clientX: 80, clientY: 90 });
    await vi.advanceTimersByTimeAsync(16); editor.pointer('pointerup', { clientX: 80, clientY: 90 });
    expect(editor.apply).toHaveBeenCalledOnce(); expect(editor.showMenu).not.toHaveBeenCalled();
    expect(editor.apply.mock.calls[0]?.[1].block.text).toBe('alpha');
    expect(editor.apply.mock.calls[0]?.[2].edits[0].insert).toBe('beta\n\nalpha');
  });

  it.each(['pointercancel', 'second-pointer', 'keyboard-resize', 'destroy'])('cancels a pending hold on %s', async reason => {
    const editor = setup('hover', true);
    await vi.runAllTimersAsync(); editor.measure(); editor.pointer('pointerdown');
    if (reason === 'pointercancel') editor.pointer('pointercancel');
    if (reason === 'second-pointer') editor.doc.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerId: 2 }));
    if (reason === 'keyboard-resize') editor.viewport.dispatchEvent(new Event('resize'));
    if (reason === 'destroy') editor.controller.destroy();
    await vi.advanceTimersByTimeAsync(400); editor.pointer('pointerup');
    expect(editor.apply).not.toHaveBeenCalled(); expect(editor.showMenu).not.toHaveBeenCalled();
    expect(editor.button.classList.add).not.toHaveBeenCalledWith('is-ready');
  });

  it('keeps tap actions when dragging is disabled', async () => {
    const editor = setup('hover', true); editor.settings.drag = false;
    await vi.runAllTimersAsync(); editor.measure();
    editor.pointer('pointerdown'); await vi.advanceTimersByTimeAsync(400); editor.pointer('pointerup');
    expect(editor.showMenu).toHaveBeenCalledOnce(); expect(editor.apply).not.toHaveBeenCalled();
  });

  it('hides handles behind the keyboard and in unfocused mobile editors', async () => {
    const editor = setup('hover', true);
    await vi.runAllTimersAsync(); editor.measure();
    editor.viewport.height = 15; editor.viewport.dispatchEvent(new Event('resize')); editor.measure();
    expect(editor.button.hidden).toBe(true);
    editor.viewport.height = 400; editor.host.hasFocus = false; editor.controller.refresh(); editor.measure();
    expect(editor.button.hidden).toBe(true);
    editor.host.hasFocus = true; editor.controller.refresh(); editor.measure();
    expect(editor.button.hidden).toBe(false);
  });

  it('preserves the desktop mouse drag without a long press', async () => {
    const editor = setup();
    await vi.runAllTimersAsync(); editor.hover(); editor.measure();
    editor.pointer('pointerdown', { pointerType: 'mouse' }); editor.pointAt(10);
    editor.pointer('pointermove', { pointerType: 'mouse', clientX: 80, clientY: 90 });
    editor.pointer('pointerup', { pointerType: 'mouse', clientX: 80, clientY: 90 });
    expect(editor.apply).toHaveBeenCalledOnce();
  });
});
