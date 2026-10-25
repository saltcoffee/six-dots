import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { Controller } from '../src/editor/controller';
import type { Actions } from '../src/obsidian/actions';

vi.mock('obsidian', async () => {
  const { StateField } = await import('@codemirror/state');
  class MarkdownView {
    file = { path: 'Test.md' };
    getMode() { return 'source'; }
  }
  return {
    MarkdownView, setIcon: vi.fn(),
    editorInfoField: StateField.define({ create: () => new MarkdownView(), update: value => value }),
  };
});
vi.mock('../src/obsidian/actions', () => ({ Actions: vi.fn() }));

const controllers: Controller[] = [];
type Measurement = NonNullable<Parameters<EditorView['requestMeasure']>[0]>;

function setup(mode: 'hover' | 'cursor' = 'hover') {
  // Keep the host DOM minimal; the layout guard models CodeMirror's update boundary.
  const bounds = { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 };
  const element = () => Object.assign(new EventTarget(), {
    hidden: false, className: '', style: { left: '', top: '' },
    classList: { add: vi.fn(), remove: vi.fn() },
    setAttribute: vi.fn(), remove: vi.fn(), getBoundingClientRect: () => bounds,
  });
  const elements: ReturnType<typeof element>[] = [];
  const doc = Object.assign(new EventTarget(), {
    createElement: () => { const el = element(); elements.push(el); return el; },
    body: { append: vi.fn() }, defaultView: null,
  });
  let phase: 'idle' | 'update' | 'read' | 'write' = 'idle';
  let pending: Measurement | null = null;
  let position = 1;
  const guard = () => {
    if (phase === 'update' || phase === 'write') throw new Error("Reading the editor layout isn't allowed during an update");
  };
  const host = {
    state: EditorState.create({ doc: 'alpha\n\nbeta', extensions: [editorInfoField] }),
    dom: Object.assign(element(), { ownerDocument: doc }), scrollDOM: element(), composing: false,
    get visibleRanges() { return [{ from: 0, to: this.state.doc.length }]; },
    posAtCoords: vi.fn(() => { guard(); return position; }),
    coordsAtPos: vi.fn((pos: number) => { guard(); return { left: 40, right: 40, top: pos < 7 ? 20 : 60, bottom: pos < 7 ? 40 : 80 }; }),
    requestMeasure: (request: Measurement) => { pending = request; },
  };
  const view = host as unknown as EditorView;
  const showMenu = vi.fn<Actions['showMenu']>(() => ({ hide: vi.fn() }) as unknown as ReturnType<Actions['showMenu']>);
  const actions = {
    t: (key: string) => key, settings: () => ({ handle: mode }),
    committing: new Set(), notify: vi.fn(), showMenu,
  } as unknown as Actions;
  const controller = new Controller(view, actions, vi.fn());
  controllers.push(controller);
  return {
    controller, host, showMenu, button: elements[0]!,
    hover(pos = 1) {
      position = pos;
      host.dom.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 80, clientY: 30 }));
    },
    pointAt(pos: number) { position = pos; },
    update(spec: TransactionSpec = {}, geometryChanged = false) {
      const transaction = host.state.update(spec);
      host.state = transaction.state;
      phase = 'update';
      try {
        controller.update({
          view, state: host.state, docChanged: transaction.docChanged, selectionSet: !!spec.selection,
          viewportChanged: geometryChanged, geometryChanged,
        } as ViewUpdate);
      } finally { phase = 'idle'; }
    },
    measure() {
      const request = pending;
      pending = null;
      if (!request) return;
      try {
        phase = 'read';
        const result = request.read(view);
        phase = 'write';
        request.write?.(result, view);
      } finally { phase = 'idle'; }
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { controllers.splice(0).forEach(controller => controller.destroy()); vi.useRealTimers(); });

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
