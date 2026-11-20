import { afterEach, beforeEach, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { editorInfoField, Platform } from 'obsidian';
import { Controller } from '../../src/editor/controller';
import type { Actions } from '../../src/obsidian/actions';

vi.mock('obsidian', async () => {
  const { StateField } = await import('@codemirror/state');
  class MarkdownView {
    file = { path: 'Test.md' };
    getMode() { return 'source'; }
  }
  return {
    MarkdownView, setIcon: vi.fn(), Platform: { isMobile: false, isIosApp: false },
    editorInfoField: StateField.define({ create: () => new MarkdownView(), update: value => value }),
  };
});
vi.mock('../../src/obsidian/actions', () => ({ Actions: vi.fn() }));

const controllers: Controller[] = [];
type Measurement = NonNullable<Parameters<EditorView['requestMeasure']>[0]>;

export function setup(mode: 'hover' | 'cursor' = 'hover', mobile = false, ios = false) {
  Platform.isMobile = mobile;
  Platform.isIosApp = ios;
  // Keep the host DOM minimal; the layout guard models CodeMirror's update boundary.
  const bounds = { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 };
  let captured: number | null = null;
  const element = (tag = 'div', ownerDoc?: unknown) => {
    const attrs = new Map<string, string>();
    return Object.assign(new EventTarget(), {
      tagName: tag.toUpperCase(), ownerDocument: ownerDoc, type: '', title: '',
      hidden: false, className: '', textContent: '', isConnected: true, nodeType: 1, style: { left: '', top: '' },
      closest: vi.fn<() => Element | null>(() => null), contains: vi.fn(() => false),
      classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
      setAttribute: vi.fn((key: string, value: string) => { attrs.set(key, value); }),
      getAttribute: (key: string) => attrs.get(key) ?? null,
      remove: vi.fn(), getBoundingClientRect: () => bounds,
      setPointerCapture: (id: number) => { captured = id; }, hasPointerCapture: (id: number) => captured === id,
      releasePointerCapture: () => { captured = null; },
    });
  };
  const applyInfo = (el: ReturnType<typeof element>, info?: { cls?: string | string[]; text?: string; title?: string; type?: string; attr?: Record<string, string | number | boolean | null> }) => {
    if (!info) return;
    if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(' ') : info.cls;
    if (info.text !== undefined) el.textContent = info.text;
    if (info.title !== undefined) el.title = info.title;
    if (info.type !== undefined) el.type = info.type;
    if (info.attr) for (const [k, v] of Object.entries(info.attr)) if (v !== null) {
      el.setAttribute(k, String(v));
      if (k === 'type') el.type = String(v);
    }
  };
  const viewport = Object.assign(new EventTarget(), { offsetLeft: 0, offsetTop: 0, width: 600, height: 400 });
  const win = Object.assign(new EventTarget(), { innerWidth: 600, innerHeight: 400, visualViewport: viewport,
    setTimeout: (callback: () => void, ms?: number) => setTimeout(callback, ms) as unknown as number,
    clearTimeout: (id?: number) => clearTimeout(id),
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16), cancelAnimationFrame: clearTimeout });
  const elements: ReturnType<typeof element>[] = [];
  const createInBody = (tag: string, info?: Parameters<typeof applyInfo>[1], callback?: (el: ReturnType<typeof element>) => void) => {
    const el = element(tag, doc);
    applyInfo(el, info);
    callback?.(el);
    elements.push(el);
    body.children.push(el);
    return el;
  };
  const body = {
    children: [] as ReturnType<typeof element>[],
    append: vi.fn(),
    createEl: vi.fn((tag: string, info?: Parameters<typeof applyInfo>[1], cb?: (el: ReturnType<typeof element>) => void) => createInBody(tag, info, cb)),
    createDiv: vi.fn((info?: Parameters<typeof applyInfo>[1], cb?: (el: ReturnType<typeof element>) => void) => createInBody('div', info, cb)),
    createSpan: vi.fn((info?: Parameters<typeof applyInfo>[1], cb?: (el: ReturnType<typeof element>) => void) => createInBody('span', info, cb)),
  };
  const doc = Object.assign(new EventTarget(), {
    body, defaultView: win, activeElement: null as ReturnType<typeof element> | null,
    elementFromPoint: vi.fn(() => host.dom as unknown as Element),
  });
  let phase: 'idle' | 'update' | 'read' | 'write' = 'idle';
  let pending: Measurement | null = null;
  let position = 1;
  const guard = () => {
    if (phase === 'update' || phase === 'write') throw new Error("Reading the editor layout isn't allowed during an update");
  };
  const host = {
    state: EditorState.create({ doc: 'alpha\n\nbeta', extensions: [editorInfoField] }),
    dom: Object.assign(element(), { ownerDocument: doc }), scrollDOM: Object.assign(element(), { scrollTop: 0 }), composing: false, hasFocus: true,
    contentDOM: { blur: vi.fn(() => { host.hasFocus = false; host.dom.dispatchEvent(new Event('focusout')); }) },
    get visibleRanges() { return [{ from: 0, to: this.state.doc.length }]; },
    posAtCoords: vi.fn(() => { guard(); return position; }),
    coordsAtPos: vi.fn<(pos: number) => ReturnType<EditorView['coordsAtPos']>>((pos: number) => { guard(); return { left: 40, right: 40, top: pos < 7 ? 20 : 60, bottom: pos < 7 ? 40 : 80 }; }),
    requestMeasure: (request: Measurement) => { pending = request; },
  };
  const view = host as unknown as EditorView;
  const showMenu = vi.fn<Actions['showMenu']>((_view, _target, _point, onHide) => {
    let hidden = false;
    return { hide: vi.fn(() => { if (!hidden) { hidden = true; onHide(); } }) } as unknown as ReturnType<Actions['showMenu']>;
  });
  const apply = vi.fn();
  const settings = { handle: mode, drag: true };
  const actions = {
    t: (key: string) => key, settings: () => settings,
    committing: new Set(), notify: vi.fn(), showMenu, apply, folded: () => false,
    moves: { attach: vi.fn(), detach: vi.fn(), contextChanged: vi.fn(), update: vi.fn(() => false), block: apply },
  } as unknown as Actions;
  const controller = new Controller(view, actions, vi.fn());
  controllers.push(controller);
  return {
    controller, host, showMenu, apply, settings, viewport, win, doc, button: elements[0]!, indicator: elements[1]!, preview: elements[2]!, status: elements[3]!,
    pointer(type: string, values: Partial<PointerEvent> = {}) {
      const event = Object.assign(new Event(type, { cancelable: true }), { button: 0, isPrimary: true, pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 30, ...values });
      (type === 'pointerdown' ? elements[0]! : doc).dispatchEvent(event);
    },
    hover(pos = 1, target: EventTarget = host.dom) {
      position = pos;
      const event = Object.assign(new Event('pointermove'), { clientX: 80, clientY: 30 });
      Object.defineProperty(event, 'target', { value: target });
      host.dom.dispatchEvent(event);
    },
    table() {
      const cell = element();
      cell.closest.mockReturnValue(cell as unknown as Element);
      return cell;
    },
    interact(type: string, target: EventTarget) {
      const event = new Event(type, { cancelable: true });
      Object.defineProperty(event, 'target', { value: target });
      host.dom.dispatchEvent(event);
      return event;
    },
    pointAt(pos: number) { position = pos; },
    update(spec: TransactionSpec = {}, geometryChanged = false) {
      const transaction = host.state.update(spec);
      host.state = transaction.state;
      phase = 'update';
      try {
        controller.update({
          view, state: host.state, startState: transaction.startState, transactions: [transaction], docChanged: transaction.docChanged, selectionSet: !!spec.selection,
          viewportChanged: geometryChanged, geometryChanged,
        } as unknown as ViewUpdate);
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

beforeEach(() => { Platform.isMobile = false; Platform.isIosApp = false; vi.useFakeTimers(); });
afterEach(() => { controllers.splice(0).forEach(controller => controller.destroy()); vi.useRealTimers(); });
