import { describe, expect, it, vi } from 'vitest';
import { Text } from '@codemirror/state';
import type { App } from 'obsidian';
import { parseSnapshot } from '../src/editor/markdown';
import { resolveRange } from '../src/domain/block-range';
import { planRangeMove } from '../src/domain/range-move';
import { moveSection } from '../src/domain/section';
import { RangeMoveModal } from '../src/ui/range-move-modal';
import { SectionMoveModal, MoveProgress } from '../src/ui/section-move-modal';
import { translator } from '../src/i18n';

interface FakeNode {
  tag: string;
  ownerDocument: FakeDocument;
  cls: string;
  text: string;
  textContent: string;
  type: string;
  disabled: boolean;
  attrs: Record<string, string>;
  style: Record<string, string>;
  children: FakeNode[];
  removed: boolean;
  listeners: Map<string, ((event: unknown) => void)[]>;
  classList: { add: (...names: string[]) => void; list: Set<string> };
  createEl(tag: string, info?: { cls?: string; text?: string; type?: string; attr?: Record<string, string> }): FakeNode;
  createDiv(info?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeNode;
  createSpan(info?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeNode;
  setText(text: string): void;
  empty(): void;
  focus(): void;
  remove(): void;
  addEventListener(type: string, fn: (event: unknown) => void): void;
  dispatch(type: string, event?: unknown): void;
}

interface FakeDocument {
  defaultView: EventTarget & { innerWidth: number; innerHeight: number; visualViewport?: EventTarget & { width: number; height: number; offsetTop: number } };
  body: FakeNode;
  listeners: Map<string, ((event: unknown) => void)[]>;
  addEventListener(type: string, fn: (event: unknown) => void): void;
  removeEventListener(type: string, fn: (event: unknown) => void): void;
  dispatchKey(key: string): void;
}

function makeNode(tag: string, ownerDocument: FakeDocument, info?: { cls?: string; text?: string; type?: string; attr?: Record<string, string> }): FakeNode {
  const list = new Set<string>(info?.cls ? info.cls.split(' ') : []);
  const node: FakeNode = {
    tag,
    ownerDocument,
    cls: info?.cls ?? '',
    text: info?.text ?? '',
    get textContent() { return this.text; },
    set textContent(value: string) { this.text = value; },
    type: info?.type ?? info?.attr?.type ?? '',
    disabled: false,
    attrs: { ...(info?.attr ?? {}) },
    style: {},
    children: [],
    removed: false,
    listeners: new Map(),
    classList: { add: (...names) => names.forEach(n => list.add(n)), list },
    createEl(childTag, childInfo) {
      const child = makeNode(childTag, ownerDocument, childInfo);
      this.children.push(child);
      return child;
    },
    createDiv(childInfo) { return this.createEl('div', childInfo); },
    createSpan(childInfo) { return this.createEl('span', childInfo); },
    setText(text) { this.text = text; },
    empty() { this.children = []; },
    focus() {},
    remove() { this.removed = true; },
    addEventListener(type, fn) {
      const existing = this.listeners.get(type) ?? [];
      existing.push(fn);
      this.listeners.set(type, existing);
    },
    dispatch(type, event = {}) {
      for (const fn of this.listeners.get(type) ?? []) fn(event);
    },
  };
  return node;
}

function makeDoc(): FakeDocument {
  const win = Object.assign(new EventTarget(), {
    innerWidth: 900,
    innerHeight: 700,
    visualViewport: Object.assign(new EventTarget(), { width: 900, height: 700, offsetTop: 0 }),
  });
  const doc: FakeDocument = {
    defaultView: win,
    body: null as unknown as FakeNode,
    listeners: new Map(),
    addEventListener(type, fn) {
      const existing = this.listeners.get(type) ?? [];
      existing.push(fn);
      this.listeners.set(type, existing);
    },
    removeEventListener(type, fn) {
      const existing = this.listeners.get(type);
      if (existing) this.listeners.set(type, existing.filter(item => item !== fn));
    },
    dispatchKey(key) {
      const event = { key, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
      for (const fn of [...(this.listeners.get('keydown') ?? [])]) fn(event);
    },
  };
  doc.body = makeNode('body', doc);
  return doc;
}

function collectTexts(node: FakeNode): string[] {
  const out: string[] = [];
  if (node.text) out.push(`${node.tag}:${node.text}`);
  for (const child of node.children) out.push(...collectTexts(child));
  return out;
}

vi.mock('obsidian', () => ({
  Platform: { isMobile: false },
  Setting: class {},
  Modal: class {
    modalEl: FakeNode;
    contentEl: FakeNode;
    title = '';
    closed = false;
    constructor() {
      const doc = makeDoc();
      this.modalEl = makeNode('div', doc);
      this.contentEl = makeNode('div', doc);
    }
    setTitle(title: string) { this.title = title; }
    open() { (this as unknown as { onOpen(): void }).onOpen(); }
    close() { this.closed = true; (this as unknown as { onClose(): void }).onClose(); }
  },
}));

describe('preview modal line lookup parity and DOM helpers', () => {
  it.each([
    {
      name: 'trailing newline, blank lines, emoji, and CRLF-normalized lines',
      raw: 'Intro 😀\r\n\r\n\r\nAlpha 🧪 line\r\n\r\nBravo 中文\r\n\r\nCharlie\r\n',
      select: (text: string) => ({ from: text.indexOf('🧪'), to: text.indexOf('中文') + 1 }),
    },
    {
      name: 'EOF without trailing newline and extra renumbered ordered items',
      raw: 'Intro\n\n7. First 😀\n8. Second\n9. Third\n10. Fourth\n11. Fifth',
      select: (text: string) => ({ from: text.indexOf('First'), to: text.indexOf('Second') + 3 }),
    },
    {
      name: 'long range with omitted order preview (> 12 units)',
      raw: Array.from({ length: 16 }, (_, i) => `Paragraph ${i} body`).join('\n\n') + '\n',
      select: (text: string) => ({ from: text.indexOf('Paragraph 1'), to: text.indexOf('Paragraph 13') + 10 }),
    },
  ])('RangeMoveModal renders identical output with CM Text doc vs fallback scan ($name)', ({ raw, select }) => {
    const doc = Text.of(raw.replace(/\r\n/g, '\n').split('\n'));
    const text = doc.toString();
    const snapshot = parseSnapshot(text);
    const original = select(text);
    const move = planRangeMove(snapshot, resolveRange(snapshot, original.from, original.to), 1);
    const t = translator('en');

    const withDoc = new RangeMoveModal({} as App, t, snapshot, move, original, true, vi.fn(), 'Note.md', doc);
    const withoutDoc = new RangeMoveModal({} as App, t, snapshot, move, original, true, vi.fn(), 'Note.md');
    withDoc.open();
    withoutDoc.open();

    const elWithDoc = (withDoc as unknown as { contentEl: FakeNode }).contentEl;
    const elWithoutDoc = (withoutDoc as unknown as { contentEl: FakeNode }).contentEl;
    expect(collectTexts(elWithDoc)).toEqual(collectTexts(elWithoutDoc));
    expect(elWithDoc.children[0]!.tag).toBe('div');
    expect(elWithDoc.children[0]!.cls).toBe('six-dots-section-summary');
    expect(elWithDoc.children.at(-1)!.tag).toBe('div');
    expect(elWithDoc.children.at(-1)!.cls).toBe('six-dots-move-controls');

    const confirmBtn = elWithDoc.children.at(-1)!.children[1]!;
    expect(confirmBtn.disabled).toBe(true);
    withDoc.ready();
    expect(confirmBtn.disabled).toBe(false);
    withDoc.expire('Expired');
    expect(confirmBtn.disabled).toBe(true);
    withDoc.close();
  });

  it('SectionMoveModal renders identical line ranges with CM Text doc vs fallback scan', () => {
    const raw = '# Top\n\nIntro 😀\n\n## Section A\nBody A\n\n### Child A1\nSub\n\n## Section B\nBody B';
    const doc = Text.of(raw.split('\n'));
    const snapshot = parseSnapshot(doc.toString());
    const move = moveSection(snapshot, doc.toString().indexOf('## Section A'), 1);
    const t = translator('en');

    const withDoc = new SectionMoveModal({} as App, t, snapshot, move, true, vi.fn(), doc);
    const withoutDoc = new SectionMoveModal({} as App, t, snapshot, move, true, vi.fn());
    withDoc.open();
    withoutDoc.open();

    const elWithDoc = (withDoc as unknown as { contentEl: FakeNode }).contentEl;
    const elWithoutDoc = (withoutDoc as unknown as { contentEl: FakeNode }).contentEl;
    expect(collectTexts(elWithDoc)).toEqual(collectTexts(elWithoutDoc));
    expect(collectTexts(elWithDoc).some(line => line.includes('Line range: 5–10'))).toBe(true);
    expect(collectTexts(elWithDoc).some(line => line.includes('Line range: 11–12'))).toBe(true);
    withDoc.close();
    withoutDoc.close();
  });

  it('MoveProgress owns DOM nodes in each window document and cleans up on cancel/close', () => {
    const docA = makeDoc(), docB = makeDoc();
    const cancelA = vi.fn(), cancelB = vi.fn();
    const t = translator('en');

    const progressA = new MoveProgress(docA as unknown as Document, t, cancelA);
    const progressB = new MoveProgress(docB as unknown as Document, t, cancelB);

    expect(docA.body.children).toHaveLength(1);
    expect(docB.body.children).toHaveLength(1);
    const rootA = docA.body.children[0]!, rootB = docB.body.children[0]!;
    expect(rootA.ownerDocument).toBe(docA);
    expect(rootB.ownerDocument).toBe(docB);
    expect(rootA.cls).toBe('six-dots-move-progress');
    expect(rootA.children.map(c => c.tag)).toEqual(['span', 'button']);
    expect(rootA.children[0]!.attrs).toMatchObject({ role: 'status', 'aria-live': 'polite' });
    expect(rootA.children[1]!.type).toBe('button');

    rootA.children[1]!.dispatch('click');
    expect(cancelA).toHaveBeenCalledOnce();
    expect(cancelB).not.toHaveBeenCalled();

    docB.dispatchKey('Escape');
    expect(cancelB).toHaveBeenCalledOnce();

    progressA.expire('Stale');
    expect(rootA.children[0]!.text).toBe('Stale');
    progressA.close();
    progressB.close();
    expect(rootA.removed).toBe(true);
    expect(rootB.removed).toBe(true);
  });
});
