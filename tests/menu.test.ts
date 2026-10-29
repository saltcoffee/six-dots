import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { App } from 'obsidian';
import { Actions } from '../src/obsidian/actions';
import { parseSnapshot } from '../src/editor/markdown';
import type { Target } from '../src/editor/context';
import { defaults } from '../src/obsidian/settings';

vi.mock('obsidian', () => ({
  Menu: class {
    private hidden = false;
    private callback = () => undefined;
    setUseNativeMenu() { return this; }
    onHide(callback: () => undefined) { this.callback = callback; }
    addSeparator() {}
    addItem() {}
    showAtPosition() {}
    hide() { if (!this.hidden) { this.hidden = true; this.callback(); } }
  },
  PluginSettingTab: class {}, Setting: class {},
}));
vi.mock('../src/ui/dialogs', () => ({}));
vi.mock('../src/editor/context', () => ({}));

function setup() {
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { defaultView: win });
  const view = { state: EditorState.create({ doc: 'alpha\n\nbeta' }), dom: { isConnected: true, ownerDocument: doc }, focus: vi.fn() };
  const snapshot = parseSnapshot(view.state.doc.toString());
  const target = { block: snapshot.roots[0]!, snapshot } as Target;
  const actions = new Actions({} as App, key => key, () => defaults);
  let hide = () => undefined;
  // The host's existing document scope hides the menu before any later document listeners.
  doc.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Escape') hide(); }, true);
  const onHide = vi.fn();
  const menu = actions.showMenu(view as unknown as EditorView, target, { x: 0, y: 0 }, onHide);
  hide = () => { menu.hide(); };
  const key = (name: string) => {
    win.dispatchEvent(Object.assign(new Event('keydown'), { key: name }));
    doc.dispatchEvent(Object.assign(new Event('keydown'), { key: name }));
  };
  return { view, actions, menu, onHide, key };
}

describe('host menu dismissal and focus', () => {
  it('restores Escape focus after the host has restored its saved focus', async () => {
    const { view, onHide, key } = setup();
    key('Escape');
    expect(onHide).toHaveBeenCalledOnce();
    expect(view.focus).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(view.focus).toHaveBeenCalledOnce();
    key('Escape');
    expect(view.focus).toHaveBeenCalledOnce();
  });

  it('cancels queued Escape focus restoration when unloading', async () => {
    const { view, actions, key } = setup();
    key('Escape'); actions.destroy();
    await Promise.resolve();
    expect(view.focus).not.toHaveBeenCalled();
  });

  it('does not reclaim focus when a menu is dismissed by an outside action', () => {
    const { view, menu, onHide } = setup();
    menu.hide();
    expect(onHide).toHaveBeenCalledOnce();
    expect(view.focus).not.toHaveBeenCalled();
  });

  it('does not reclaim focus during unload', () => {
    const { view, actions, onHide, key } = setup();
    actions.destroy(); key('Escape');
    expect(onHide).toHaveBeenCalledOnce();
    expect(view.focus).not.toHaveBeenCalled();
  });
});
