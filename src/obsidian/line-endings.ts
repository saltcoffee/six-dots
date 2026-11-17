import { MarkdownView, editorInfoField } from 'obsidian';
import type { App, TFile } from 'obsidian';
import type { EditorView } from '@codemirror/view';

function usesCRLF(text: string): boolean {
  return text.includes('\r\n') && !/(^|[^\r])\n|\r(?!\n)/.test(text);
}

/** Preserve the loaded format at the host's public save boundary, without a second file write. */
export class LineEndings {
  private cleanups = new Map<MarkdownView, { file: TFile; cleanup: () => void }>();
  constructor(private app: App) {}

  preserve(view: EditorView): void {
    const source = view.state.field(editorInfoField, false);
    if (!(source instanceof MarkdownView) || !source.file
      || this.cleanups.get(source)?.file !== source.file && !usesCRLF(source.data)) return;
    const views = new Set([source, ...this.app.workspace.getLeavesOfType('markdown')
      .map(leaf => leaf.view).filter((candidate): candidate is MarkdownView => candidate instanceof MarkdownView && candidate.file === source.file)]);
    for (const candidate of views) this.wrap(candidate, source.file);
  }

  private wrap(view: MarkdownView, file: TFile): void {
    const previous = this.cleanups.get(view);
    if (previous?.file === file) return;
    previous?.cleanup();
    const descriptor = Object.getOwnPropertyDescriptor(view, 'getViewData');
    const original = view.getViewData;
    const unloadDescriptor = Object.getOwnPropertyDescriptor(view, 'onUnloadFile');
    const originalUnload = view.onUnloadFile;
    let active = true;
    const wrapped = function(this: MarkdownView): string {
      const text = original.call(this);
      // The host also normalizes data during history and peer synchronization.
      // Keep the loaded format for this file identity, independently of that cache.
      return active && this.file === file ? text.replace(/\r?\n/g, '\r\n') : text;
    };
    const unload = async function(this: MarkdownView, unloaded: TFile): Promise<void> {
      try { await originalUnload.call(this, unloaded); }
      finally { cleanup(); }
    };
    const cleanup = () => {
      if (!active) return;
      active = false;
      if (view.getViewData === wrapped) {
        if (descriptor) Object.defineProperty(view, 'getViewData', descriptor);
        else Reflect.deleteProperty(view, 'getViewData');
      }
      if (view.onUnloadFile === unload) {
        if (unloadDescriptor) Object.defineProperty(view, 'onUnloadFile', unloadDescriptor);
        else Reflect.deleteProperty(view, 'onUnloadFile');
      }
      this.cleanups.delete(view);
    };
    view.getViewData = wrapped;
    view.onUnloadFile = unload;
    this.cleanups.set(view, { file, cleanup });
  }

  destroy(): void { for (const { cleanup } of this.cleanups.values()) cleanup(); }
}
