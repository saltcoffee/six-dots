import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { history } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import type { App } from 'obsidian';
import { editorInfoField, TFile, TFolder } from 'obsidian';
import { Actions } from '../src/obsidian/actions';
import { targetFor } from '../src/editor/context';
import { parseSnapshot } from '../src/editor/markdown';
import { defaults } from '../src/obsidian/settings';

type Submit = (name: string, folder: string, active: () => boolean) => Promise<{ message: string; retryable: boolean } | null>;
const ui = vi.hoisted(() => ({ submits: [] as Submit[], notices: [] as string[] }));
vi.mock('obsidian', async () => {
  const { StateField } = await import('@codemirror/state');
  class TFile {
    stat = { mtime: 0, size: 0 };
    constructor(public path: string) {}
    get name() { return this.path.split('/').at(-1)!; }
  }
  class TFolder { children: TFile[] = []; }
  class MarkdownView { file: TFile | null = null; getMode() { return 'source'; } }
  return {
    TFile, TFolder, MarkdownView, PluginSettingTab: class {}, Setting: class {},
    Notice: class { constructor(message: string | { text: string }) { ui.notices.push(typeof message === 'string' ? message : message.text); } },
    editorInfoField: StateField.define({ create: () => new MarkdownView(), update: value => value }),
  };
});
vi.mock('../src/ui/dialogs', () => ({
  ExtractModal: class {
    onDismiss = () => undefined;
    constructor(_app: unknown, _t: unknown, _data: unknown, submit: Submit) { ui.submits.push(submit); }
    open() {}
    close() { this.onDismiss(); }
  },
}));

function setup() {
  ui.submits = []; ui.notices = [];
  const root = new TFolder(), source = Object.assign(new TFile(), { path: 'Source.md' });
  root.children.push(source);
  const files = new Map([['Source.md', source]]);
  const content = new Map<string, string>();
  const view = {
    state: EditorState.create({ doc: 'alpha\n\nbeta', extensions: [editorInfoField, history()] }),
    dom: { isConnected: true, nodeType: 1, closest: () => null, ownerDocument: {
      createDocumentFragment() {
        return { text: '', createEl(_tag: string, options: { text: string }) {
          this.text += options.text; return { addEventListener() {} };
        } };
      },
    } },
    composing: false, focus: vi.fn(),
    dispatch(transaction: { state: EditorState }) { this.state = transaction.state; },
  };
  Object.assign(view.state.field(editorInfoField)!, { file: source });
  const snapshot = parseSnapshot(view.state.doc.toString());
  const target = targetFor(view as unknown as EditorView, snapshot.roots[0]!, snapshot)!;
  const vault = {
    getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    getRoot: () => root,
    create: vi.fn(async (path: string, text: string) => {
      const file = Object.assign(new TFile(), { path }); files.set(path, file); content.set(path, text); root.children.push(file); return file;
    }),
    adapter: { exists: vi.fn(async (path: string) => files.has(path)) },
    read: vi.fn(async (file: TFile) => content.get(file.path) ?? ''),
  };
  const app = {
    vault, workspace: { getLeavesOfType: () => [] },
    fileManager: { generateMarkdownLink: (file: TFile) => `[[${file.path.replace(/\.md$/, '')}]]` },
    metadataCache: { getFirstLinkpathDest: (path: string) => files.get(path) ?? files.get(path + '.md') ?? null },
  } as unknown as App;
  const actions = new Actions(app, key => key, () => defaults);
  const open = () => { actions.extract(view as unknown as EditorView, target); return ui.submits.at(-1)!; };
  return { actions, open, view, target, vault, files, content, root };
}

describe('host extraction safety', () => {
  it('reports invalid names as input errors without creating a file', async () => {
    const host = setup(), submit = host.open();
    expect(await submit('bad/name', '', () => true)).toEqual({ message: 'badPath', retryable: true });
    expect(host.vault.create).not.toHaveBeenCalled();
  });

  it('allows correcting a missing directory and a conflicting name before creating once', async () => {
    const host = setup(), submit = host.open();
    expect((await submit('Target', 'Missing', () => true))?.retryable).toBe(true);
    expect((await submit('Source', '', () => true))?.message).toBe('conflict');
    expect(host.vault.create).not.toHaveBeenCalled();
    expect(await submit('Target', '', () => true)).toBeNull();
    expect(host.vault.create).toHaveBeenCalledOnce();
    expect(host.view.state.doc.toString()).toBe('[[Target]]\n\nbeta');
  });

  it.each(['closed', 'unloaded', 'stale'] as const)('does not start a create from a %s operation', async state => {
    const host = setup(), submit = host.open();
    if (state === 'unloaded') host.actions.destroy();
    if (state === 'stale') host.view.state = host.view.state.update({ changes: { from: 0, insert: 'external ' } }).state;
    const result = await submit('Target', '', () => state !== 'closed');
    expect(result?.retryable).toBe(false);
    expect(host.vault.create).not.toHaveBeenCalled();
  });

  it('does not open dialogs from an unloaded instance or stale target', () => {
    const host = setup();
    host.view.state = host.view.state.update({ changes: { from: 0, insert: 'external ' } }).state;
    host.open(); expect(ui.submits).toHaveLength(0);
    host.actions.destroy(); host.open(); expect(ui.submits).toHaveLength(0);
  });

  it('keeps the target path visible when creation succeeded but the call failed', async () => {
    const host = setup(), submit = host.open(), create = host.vault.create.getMockImplementation()!;
    host.vault.create.mockImplementation(async (path, text) => { await create(path, text); throw new Error('Unknown result'); });
    const result = await submit('Target', '', () => true);
    expect(result?.retryable).toBe(false);
    expect(result?.message).toContain('Target.md');
    expect(ui.notices.some(message => message.includes('Target.md'))).toBe(true);
    expect(host.view.state.doc.toString()).toBe('alpha\n\nbeta');
    expect(host.files.has('Target.md')).toBe(true);
    expect(host.vault.create).toHaveBeenCalledOnce();
  });

  it('keeps an externally changed source after asynchronous target verification', async () => {
    const host = setup(), submit = host.open();
    host.vault.read.mockImplementation(async file => {
      host.view.state = host.view.state.update({ changes: { from: 0, insert: 'external ' } }).state;
      return host.content.get(file.path)!;
    });
    expect((await submit('Target', '', () => true))?.retryable).toBe(false);
    expect(host.view.state.doc.toString()).toBe('external alpha\n\nbeta');
    expect(host.content.get('Target.md')).toBe('alpha\n');
  });

  it('holds a source-file lock across pending creates and releases it without a second create', async () => {
    const host = setup(), first = host.open(), second = host.open();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const create = host.vault.create.getMockImplementation()!;
    host.vault.create.mockImplementation(async (path, text) => { const file = await create(path, text); await pending; return file; });
    const firstResult = first('First', '', () => true);
    expect((await second('Second', '', () => true))?.message).toBe('working');
    release(); expect(await firstResult).toBeNull();
    expect(host.vault.create).toHaveBeenCalledOnce();
    expect(host.files.has('Second.md')).toBe(false);
  });

  it('keeps a completed create after unload without replacing the source or reporting success', async () => {
    const host = setup(), submit = host.open(), create = host.vault.create.getMockImplementation()!;
    host.vault.create.mockImplementation(async (path, text) => {
      const file = await create(path, text); host.actions.destroy(); return file;
    });
    await submit('Target', '', () => true);
    expect(host.view.state.doc.toString()).toBe('alpha\n\nbeta');
    expect(host.files.has('Target.md')).toBe(true);
    expect(ui.notices).toHaveLength(0);
  });
});
