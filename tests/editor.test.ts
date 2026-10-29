import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { history, undo, redo } from '@codemirror/commands';
import { editorInfoField } from 'obsidian';
import { parseSnapshot } from '../src/editor/markdown';
import { dispatchPlan } from '../src/editor/dispatch';
import { targetFor } from '../src/editor/context';
import { moveBy } from '../src/domain/move';
import { convert } from '../src/domain/convert';
import { addBlockId } from '../src/domain/block-link';
import { atPosition } from '../src/domain/block';

vi.mock('obsidian', async () => {
  const { StateField } = await import('@codemirror/state');
  class MarkdownView {
    file = { path: 'Test.md' };
    getMode() { return 'source'; }
  }
  return { MarkdownView, editorInfoField: StateField.define({ create: () => new MarkdownView(), update: value => value }) };
});

function setup(filter?: 'reject' | 'rewrite') {
  const effects = filter ? EditorState.transactionFilter.of(() => filter === 'reject' ? [] : { changes: { from: 0, to: 1, insert: 'Unexpected' } }) : [];
  const view = {
    state: EditorState.create({ doc: 'alpha\n\nbeta', extensions: [editorInfoField, history(), effects] }),
    dom: { isConnected: true, nodeType: 1, closest: vi.fn<() => Element | null>(() => null) }, composing: false, focus: vi.fn(),
    dispatch(transaction: Transaction) { this.state = transaction.state; },
  };
  const snapshot = parseSnapshot(view.state.doc.toString());
  const source = snapshot.roots[0]!;
  const target = targetFor(view as unknown as EditorView, source, snapshot)!;
  const plan = moveBy(snapshot, source, 1)!;
  return { view, target, plan };
}
describe('real CM transactions with a minimal host boundary', () => {
  it.each(['move', 'task', 'bullet', 'id'] as const)('keeps %s between separate keyboard edits and restores a nonzero caret', action => {
    const { view } = setup();
    view.dispatch(view.state.update({ changes: { from: 5, insert: '!' }, selection: { anchor: 3 } }));
    const before = view.state.doc.toString();
    const snapshot = parseSnapshot(before), source = snapshot.roots[0]!;
    const target = targetFor(view as unknown as EditorView, source, snapshot)!;
    const format = action === 'task' || action === 'bullet' ? action : undefined;
    const plan = action === 'move' ? moveBy(snapshot, source, 1) : format
      ? convert(source, format, snapshot, 3) : addBlockId(source, 'new-id');
    expect(dispatchPlan(view as unknown as EditorView, target, plan!, format)).toBe('applied');
    const after = view.state.doc.toString();
    view.dispatch(view.state.update({ changes: { from: view.state.doc.length, insert: '?' } }));
    undo({ state: view.state, dispatch: transaction => view.dispatch(transaction) });
    expect(view.state.doc.toString()).toBe(after);
    undo({ state: view.state, dispatch: transaction => view.dispatch(transaction) });
    expect(view.state.doc.toString()).toBe(before);
    expect(view.state.selection.main.head).toBe(3);
    undo({ state: view.state, dispatch: transaction => view.dispatch(transaction) });
    expect(view.state.doc.toString()).toBe('alpha\n\nbeta');
    redo({ state: view.state, dispatch: transaction => view.dispatch(transaction) });
    redo({ state: view.state, dispatch: transaction => view.dispatch(transaction) });
    expect(view.state.doc.toString()).toBe(after);
  });

  it.each(['replace', 'rename', 'read-only'] as const)('rejects a target after a %s without modifying its current document', change => {
    const { view, target, plan } = setup();
    if (change === 'replace') Object.assign(view.state.field(editorInfoField)!, { file: { path: target.path } });
    if (change === 'rename') target.file.path = 'Renamed.md';
    if (change === 'read-only') view.state = EditorState.create({ doc: view.state.doc, extensions: [editorInfoField, EditorState.readOnly.of(true)] });
    const before = view.state.doc.toString();
    expect(dispatchPlan(view as unknown as EditorView, target, plan)).toBe('rejected');
    expect(view.state.doc.toString()).toBe(before);
  });

  it('creates an isolated, undoable move and restores selection', () => {
    const { view, target, plan } = setup();
    expect(dispatchPlan(view as unknown as EditorView, target, plan)).toBe('applied');
    expect(view.state.doc.toString()).toBe('beta\n\nalpha');
    expect(view.state.selection.main.head).toBe(6);
    expect(undo({ state: view.state, dispatch: transaction => view.dispatch(transaction) })).toBe(true);
    expect(view.state.doc.toString()).toBe('alpha\n\nbeta');
    expect(view.state.selection.main.head).toBe(0);
    expect(redo({ state: view.state, dispatch: transaction => view.dispatch(transaction) })).toBe(true);
    expect(view.state.doc.toString()).toBe('beta\n\nalpha');
  });
  it('keeps edits separate from following keyboard input', () => {
    const { view, target, plan } = setup();
    dispatchPlan(view as unknown as EditorView, target, plan);
    view.dispatch(view.state.update({ changes: { from: 11, insert: '!' } }));
    undo({ state: view.state, dispatch: transaction => view.dispatch(transaction) });
    expect(view.state.doc.toString()).toBe('beta\n\nalpha');
    undo({ state: view.state, dispatch: transaction => view.dispatch(transaction) });
    expect(view.state.doc.toString()).toBe('alpha\n\nbeta');
  });
  it.each(['reject', 'rewrite'] as const)('does not bypass a host filter that would %s the edit', filter => {
    const { view, target, plan } = setup(filter);
    expect(dispatchPlan(view as unknown as EditorView, target, plan)).toBe('rejected');
    expect(view.state.doc.toString()).toBe('alpha\n\nbeta');
  });
  it('rejects stale documents and closed views', () => {
    const { view, target, plan } = setup();
    view.dispatch(view.state.update({ changes: { from: 0, insert: 'changed ' } }));
    expect(dispatchPlan(view as unknown as EditorView, target, plan)).toBe('rejected');
    view.dom.isConnected = false;
    expect(dispatchPlan(view as unknown as EditorView, target, plan)).toBe('rejected');
  });
  it('rejects cell-local targets and stale edits once an editor is attached inside a table', () => {
    const { view, target, plan } = setup();
    view.dom.closest.mockReturnValue({} as Element);
    expect(targetFor(view as unknown as EditorView, target.block, target.snapshot)).toBeNull();
    expect(dispatchPlan(view as unknown as EditorView, target, plan)).toBe('rejected');
    expect(view.state.doc.toString()).toBe('alpha\n\nbeta');
  });
  it('refuses a structural merge of adjacent list containers', () => {
    const { view } = setup();
    view.state = EditorState.create({ doc: '- a\n\nbreak\n\n- b', extensions: [editorInfoField, history()] });
    const snapshot = parseSnapshot(view.state.doc.toString());
    const source = snapshot.roots.find(block => block.kind === 'paragraph')!;
    const target = targetFor(view as unknown as EditorView, source, snapshot)!;
    expect(() => dispatchPlan(view as unknown as EditorView, target, moveBy(snapshot, source, 1)!)).toThrow();
    expect(view.state.doc.toString()).toBe('- a\n\nbreak\n\n- b');
  });
  it('refuses a format conversion that reattaches a neighboring whole-list ID', () => {
    const { view } = setup();
    const text = 'Intro\n\n- Existing\n\n^whole';
    view.state = EditorState.create({ doc: text, extensions: [editorInfoField, history()] });
    const snapshot = parseSnapshot(text), source = snapshot.roots[0]!;
    const target = targetFor(view as unknown as EditorView, source, snapshot)!;
    expect(() => dispatchPlan(view as unknown as EditorView, target, convert(source, 'task', snapshot)!, 'task')).toThrow();
    expect(view.state.doc.toString()).toBe(text);
  });
  it('rejects an ID plan whose ID does not actually bind to its target', () => {
    const { view } = setup();
    const text = '- parent\n  continuation\n- sibling';
    view.state = EditorState.create({ doc: text, extensions: [editorInfoField, history()] });
    const snapshot = parseSnapshot(text), source = atPosition(snapshot, 2)!;
    const target = targetFor(view as unknown as EditorView, source, snapshot)!;
    const badPlan = { edits: [{ from: 8, to: 8, insert: ' ^new' }], cursor: 8, createdId: 'new' };
    expect(() => dispatchPlan(view as unknown as EditorView, target, badPlan)).toThrow();
    expect(view.state.doc.toString()).toBe(text);
    expect(undo({ state: view.state, dispatch: transaction => view.dispatch(transaction) })).toBe(false);
  });
  it('creates an isolated, reusable multiline-list ID while retaining the child ID', () => {
    const { view } = setup();
    const text = '- parent\n  continuation\n  - child ^child\n- sibling';
    view.state = EditorState.create({ doc: text, extensions: [editorInfoField, history()] });
    const snapshot = parseSnapshot(text), source = atPosition(snapshot, 2)!;
    const target = targetFor(view as unknown as EditorView, source, snapshot)!;
    expect(dispatchPlan(view as unknown as EditorView, target, addBlockId(source, 'parent'))).toBe('applied');
    const next = parseSnapshot(view.state.doc.toString());
    expect(atPosition(next, 2)?.ownId?.value).toBe('parent');
    expect(next.blocks.find(block => block.ownId?.value === 'child')?.kind).toBe('list-item');
    expect(undo({ state: view.state, dispatch: transaction => view.dispatch(transaction) })).toBe(true);
    expect(view.state.doc.toString()).toBe(text);
  });
  it('rejects a forged task conversion that still contains an indented code block', () => {
    const { view } = setup();
    const text = '-     const code = 1;\n- sibling';
    view.state = EditorState.create({ doc: text, extensions: [editorInfoField, history()] });
    const snapshot = parseSnapshot(text), source = atPosition(snapshot, 8)!;
    const target = targetFor(view as unknown as EditorView, source, snapshot)!;
    expect(() => dispatchPlan(view as unknown as EditorView, target, { edits: [{ from: 6, to: 6, insert: '[ ] ' }], cursor: 10 }, 'task')).toThrow();
    expect(view.state.doc.toString()).toBe(text);
  });
  it('keeps compact descendants intact when a normal sibling moves around their parent', () => {
    const { view } = setup();
    const text = '- - child one\n  - child two\n- sibling';
    view.state = EditorState.create({ doc: text, extensions: [editorInfoField, history()] });
    const snapshot = parseSnapshot(text), source = atPosition(snapshot, text.indexOf('sibling'))!;
    const target = targetFor(view as unknown as EditorView, source, snapshot)!;
    expect(dispatchPlan(view as unknown as EditorView, target, moveBy(snapshot, source, -1)!)).toBe('applied');
    expect(view.state.doc.toString()).toBe('- sibling\n- - child one\n  - child two');
    expect(atPosition(parseSnapshot(view.state.doc.toString()), view.state.doc.toString().indexOf('child one'))).toBeNull();
  });
});
