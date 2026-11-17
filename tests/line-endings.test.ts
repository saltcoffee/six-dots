import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { history, redo, undo } from '@codemirror/commands';
import { MarkdownView, editorInfoField } from 'obsidian';
import type { App } from 'obsidian';
import { LineEndings } from '../src/obsidian/line-endings';

vi.mock('obsidian', async () => {
  const { StateField } = await import('@codemirror/state');
  class MarkdownView {
    data = '';
    file = { path: 'Test.md' };
    read = () => '';
    saved = '';
    getViewData() { return this.read(); }
    async onUnloadFile() { await Promise.resolve(); this.saved = this.getViewData(); }
  }
  return { MarkdownView, editorInfoField: StateField.define({ create: () => new MarkdownView(), update: value => value }) };
});

function editor(text: string) {
  const raw = {
    state: EditorState.create({ doc: text, selection: { anchor: 3 }, extensions: [editorInfoField, history()] }),
    dispatch(tr: Transaction) { this.state = tr.state; },
  };
  raw.dispatch = raw.dispatch.bind(raw);
  const info = raw.state.field(editorInfoField) as MarkdownView;
  Object.assign(info, { data: text, read: () => raw.state.doc.toString() });
  return { raw, info, view: raw as unknown as EditorView,
    save: () => { const data = info.getViewData(); info.data = data; return data; } };
}

function host(...editors: ReturnType<typeof editor>[]) {
  return new LineEndings({ workspace: { getLeavesOfType: () => editors.map(({ info }) => ({ view: info })) } } as unknown as App);
}

describe('host serialization of CRLF notes edited by SixDots', () => {
  it('saves original line endings through edits, undo and redo while CM offsets remain logical', () => {
    const original = 'Alpha 中文 🧪.\r\n\r\nBravo.\r\n';
    const source = editor(original), endings = host(source);
    const originalDoc = source.raw.state.doc, selection = source.raw.state.selection;
    endings.preserve(source.view);
    expect(source.raw.state.doc).toBe(originalDoc);
    expect(source.raw.state.selection).toBe(selection);
    source.raw.dispatch(source.raw.state.update({ changes: { from: 0, insert: 'X' } }));
    expect(source.save()).toBe(`X${original}`);
    expect(source.raw.state.doc.toString()).toBe(`X${original.replace(/\r\n/g, '\n')}`);
    undo(source.raw); expect(source.save()).toBe(original);
    redo(source.raw); expect(source.save()).toBe(`X${original}`);
    endings.destroy();
  });

  it('preserves the serialization of same-file peers and leaves other files unchanged', () => {
    const source = editor('Alpha.\r\n\r\nBravo.\r\n'), peer = editor(source.info.data), other = editor(source.info.data);
    peer.info.file = source.info.file;
    const endings = host(source, peer, other), unrelated = other.info.getViewData;
    endings.preserve(source.view);
    expect(peer.save()).toBe(source.info.data);
    expect(other.info.getViewData).toBe(unrelated);
    expect(other.info.getViewData()).toBe(source.raw.state.doc.toString());
    endings.destroy();
  });

  it.each(['Alpha.\n\nBravo.\n', 'Alpha.\r\n\nBravo.\r\n'])('does not impose CRLF on another loaded format: %j', text => {
    const source = editor(text), endings = host(source), original = source.info.getViewData;
    endings.preserve(source.view);
    expect(source.info.getViewData).toBe(original);
    endings.destroy();
  });

  it('retains CRLF when host synchronization normalizes its in-memory cache', () => {
    const source = editor('Alpha.\r\n\r\nBravo.\r\n'), endings = host(source);
    endings.preserve(source.view);
    source.info.data = source.raw.state.doc.toString();
    endings.preserve(source.view);
    expect(source.save()).toBe('Alpha.\r\n\r\nBravo.\r\n');
    endings.destroy();
  });

  it('uses the newly loaded format when an editor changes files', () => {
    const source = editor('Alpha.\r\n\r\nBravo.\r\n'), endings = host(source);
    endings.preserve(source.view);
    source.info.file = { path: 'Another.md' } as typeof source.info.file;
    source.info.data = 'Another.\n';
    source.raw.dispatch(source.raw.state.update({ changes: { from: 0, to: source.raw.state.doc.length, insert: 'Another.\n' } }));
    expect(source.save()).toBe('Another.\n');
    source.info.data = 'Reloaded.\r\n';
    source.info.file = { path: 'Reloaded.md' } as typeof source.info.file;
    source.raw.dispatch(source.raw.state.update({ changes: { from: 0, to: source.raw.state.doc.length, insert: 'Reloaded.\n' } }));
    endings.preserve(source.view);
    expect(source.save()).toBe('Reloaded.\r\n');
    endings.destroy();
  });

  it('is idempotent and restores an inherited serialization method when unloaded', () => {
    const source = editor('Alpha.\r\n\r\nBravo.\r\n'), endings = host(source), original = source.info.getViewData;
    endings.preserve(source.view); endings.preserve(source.view);
    expect(source.save()).toBe('Alpha.\r\n\r\nBravo.\r\n');
    endings.destroy();
    expect(source.info.getViewData).toBe(original);
    expect(Object.hasOwn(source.info, 'getViewData')).toBe(false);
  });

  it('restores an existing own method and respects wrappers installed later', () => {
    const source = editor('Alpha.\r\n\r\nBravo.\r\n'), endings = host(source);
    const original = function(this: MarkdownView) { return this.data.replace(/\r\n/g, '\n'); };
    source.info.getViewData = original;
    endings.preserve(source.view); endings.destroy();
    expect(source.info.getViewData).toBe(original);
    endings.preserve(source.view);
    const ours = source.info.getViewData, outer = () => ours.call(source.info) + 'suffix';
    source.info.getViewData = outer;
    endings.destroy();
    expect(source.info.getViewData).toBe(outer);
    expect(source.info.getViewData()).toBe('Alpha.\n\nBravo.\nsuffix');
  });

  it('preserves the final asynchronous host save before restoring methods on file unload', async () => {
    const source = editor('Alpha.\r\n\r\nBravo.\r\n'), endings = host(source);
    const original = source.info.getViewData, originalUnload = source.info.onUnloadFile;
    endings.preserve(source.view);
    await source.info.onUnloadFile(source.info.file!);
    expect((source.info as unknown as { saved: string }).saved).toBe('Alpha.\r\n\r\nBravo.\r\n');
    expect(source.info.getViewData).toBe(original);
    expect(source.info.onUnloadFile).toBe(originalUnload);
    endings.destroy();
  });

  it('restores serialization after failed file unload and preserves host failures', async () => {
    const source = editor('Alpha.\r\n\r\nBravo.\r\n'), endings = host(source);
    const original = vi.fn(() => { throw new Error('Host serialization failed'); });
    source.info.getViewData = original;
    endings.preserve(source.view);
    expect(() => source.save()).toThrow('Host serialization failed');
    await expect(source.info.onUnloadFile(source.info.file!)).rejects.toThrow('Host serialization failed');
    expect(source.info.getViewData).toBe(original);
    endings.destroy();
  });
});
