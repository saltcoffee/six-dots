import { setup } from './helpers/controller';
import { describe, expect, it, vi } from 'vitest';
import { editorInfoField } from 'obsidian';

describe('editor context lifecycle', () => {
  it.each(['missing', 'offscreen'] as const)('does not commit an invisible drop with a %s boundary', async boundary => {
    const editor = setup();
    await vi.runAllTimersAsync(); editor.hover(); editor.measure();
    editor.pointer('pointerdown', { pointerType: 'mouse' });
    editor.pointAt(10); editor.host.coordsAtPos.mockReturnValue(boundary === 'missing' ? null : { left: 40, right: 40, top: 450, bottom: 470 });
    editor.pointer('pointermove', { pointerType: 'mouse', clientX: 80, clientY: 90 });
    await vi.advanceTimersByTimeAsync(16);
    expect(editor.indicator.hidden).toBe(true);
    editor.pointer('pointerup', { pointerType: 'mouse', clientX: 80, clientY: 90 });
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it('does not redirect a drop over another list back into the source list', async () => {
    const editor = setup();
    const text = '- first\n- second\n\nbreak\n\n- other\n- last';
    editor.update({ changes: { from: 0, to: editor.host.state.doc.length, insert: text } });
    await vi.runAllTimersAsync(); editor.hover(2); editor.measure();
    editor.pointer('pointerdown', { pointerType: 'mouse' }); editor.pointAt(text.indexOf('other'));
    editor.pointer('pointermove', { pointerType: 'mouse', clientX: 80, clientY: 90 });
    editor.pointer('pointerup', { pointerType: 'mouse', clientX: 80, clientY: 90 });
    expect(editor.apply).not.toHaveBeenCalled();
    expect(editor.host.state.doc.toString()).toBe(text);
  });

  it.each(['Enter', ' '] as const)('keeps the opening %s key from reaching the newly opened host menu', async key => {
    const editor = setup('cursor');
    await vi.runAllTimersAsync(); editor.measure();
    const hostKey = vi.fn(() => editor.showMenu.mock.results[0]?.value.hide());
    editor.doc.addEventListener('keydown', hostKey);
    const event = Object.assign(new Event('keydown', { cancelable: true, bubbles: true }), { key });
    editor.button.dispatchEvent(event);
    // The minimal EventTarget host has no DOM parents; route only unconsumed events upward.
    if (!event.cancelBubble) editor.doc.dispatchEvent(event);
    expect(editor.showMenu).toHaveBeenCalledOnce();
    expect(hostKey).not.toHaveBeenCalled();
    expect(editor.showMenu.mock.results[0]!.value.hide).not.toHaveBeenCalled();
  });

  it('keeps an assistive click from being treated as a click outside its new menu', async () => {
    const editor = setup('cursor');
    await vi.runAllTimersAsync(); editor.measure();
    const outside = vi.fn(() => editor.showMenu.mock.results[0]?.value.hide());
    editor.doc.addEventListener('click', outside);
    const event = Object.assign(new Event('click', { cancelable: true, bubbles: true }), { detail: 0 });
    editor.button.dispatchEvent(event);
    if (!event.cancelBubble) editor.doc.dispatchEvent(event);
    expect(editor.showMenu).toHaveBeenCalledOnce();
    expect(outside).not.toHaveBeenCalled();
  });

  it.each(['switch', 'rename'] as const)('cancels a pending hold when the file would %s without a text change', async change => {
    const editor = setup('cursor', true);
    await vi.runAllTimersAsync(); editor.measure(); editor.pointer('pointerdown');
    const info = editor.host.state.field(editorInfoField)!;
    if (change === 'switch') Object.assign(info, { file: { path: 'Other.md' } });
    else info.file!.path = 'Renamed.md';
    editor.update();
    await vi.advanceTimersByTimeAsync(400); editor.pointer('pointerup');
    expect(editor.showMenu).not.toHaveBeenCalled();
    expect(editor.apply).not.toHaveBeenCalled();
    expect(editor.button.classList.add).not.toHaveBeenCalledWith('is-ready');
  });

  it('closes a menu when its file changes without a document change', async () => {
    const editor = setup('cursor');
    await vi.runAllTimersAsync(); editor.measure(); editor.controller.openMenu();
    Object.assign(editor.host.state.field(editorInfoField)!, { file: { path: 'Other.md' } });
    editor.update();
    expect(editor.showMenu.mock.results[0]!.value.hide).toHaveBeenCalledOnce();
    expect(editor.button.setAttribute).toHaveBeenCalledWith('aria-expanded', 'false');
  });

  it('stops an already queued drag frame after a rename before the next editor update', async () => {
    const editor = setup();
    await vi.runAllTimersAsync(); editor.hover(); editor.measure();
    editor.pointer('pointerdown', { pointerType: 'mouse' }); editor.pointAt(10);
    editor.pointer('pointermove', { pointerType: 'mouse', clientX: 80, clientY: 390 });
    editor.host.state.field(editorInfoField)!.file!.path = 'Renamed.md';
    await vi.advanceTimersByTimeAsync(100);
    editor.pointer('pointerup', { pointerType: 'mouse', clientX: 80, clientY: 390 });
    expect(editor.apply).not.toHaveBeenCalled();
    expect(editor.host.scrollDOM.scrollTop).toBe(0);
    expect(editor.preview.hidden).toBe(true);
  });

  it('does not reopen menus or return actionable targets after destruction', async () => {
    const editor = setup('cursor');
    await vi.runAllTimersAsync(); editor.measure();
    editor.controller.destroy(); editor.controller.openMenu(true);
    expect(editor.controller.current()).toBeNull();
    expect(editor.controller.peek()).toBeNull();
    expect(editor.showMenu).not.toHaveBeenCalled();
    editor.measure();
    expect(editor.button.remove).toHaveBeenCalledOnce();
    editor.controller.destroy();
    expect(editor.button.remove).toHaveBeenCalledOnce();
  });

  it('keeps a focused touch handle usable and hides it after focus leaves the handle', async () => {
    const editor = setup('cursor', true);
    await vi.runAllTimersAsync(); editor.measure();
    editor.host.hasFocus = false; editor.doc.activeElement = editor.button;
    editor.controller.refresh(); editor.measure();
    expect(editor.button.hidden).toBe(false);
    editor.doc.activeElement = null;
    editor.button.dispatchEvent(new Event('focusout'));
    editor.measure();
    expect(editor.button.hidden).toBe(true);
  });

  it.each(['blur', 'compositionstart', 'pointercancel', 'lostpointercapture', 'Escape', 'second-pointer', 'document-change', 'destroy'] as const)(
    'stops an active drag and all later commits on %s', async reason => {
      const editor = setup();
      await vi.runAllTimersAsync(); editor.hover(); editor.measure();
      editor.pointer('pointerdown', { pointerType: 'mouse' }); editor.pointAt(10);
      editor.pointer('pointermove', { pointerType: 'mouse', clientX: 80, clientY: 390 });
      if (reason === 'blur') editor.win.dispatchEvent(new Event('blur'));
      if (reason === 'compositionstart') editor.host.dom.dispatchEvent(new Event('compositionstart'));
      if (reason === 'pointercancel') editor.pointer('pointercancel');
      if (reason === 'lostpointercapture') editor.button.dispatchEvent(new Event('lostpointercapture'));
      if (reason === 'Escape') editor.doc.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
      if (reason === 'second-pointer') editor.doc.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerId: 2 }));
      if (reason === 'document-change') editor.update({ changes: { from: 0, insert: 'external ' } });
      if (reason === 'destroy') editor.controller.destroy();
      const scroll = editor.host.scrollDOM.scrollTop;
      await vi.advanceTimersByTimeAsync(100);
      editor.pointer('pointerup', { pointerType: 'mouse', clientX: 80, clientY: 390 });
      expect(editor.apply).not.toHaveBeenCalled();
      expect(editor.host.scrollDOM.scrollTop).toBe(scroll);
      expect(editor.preview.hidden).toBe(true);
      expect(editor.indicator.hidden).toBe(true);
    },
  );
});
