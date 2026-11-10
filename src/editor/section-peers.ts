import { Annotation, EditorState, StateField } from '@codemirror/state';
import type { Extension, Text } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import type { TFile } from 'obsidian';
import { fileFor } from './context';
import { mapSectionFolds, mapSectionSelection, readFolds, sameFolds, sectionMoveEffect } from './section-folds';
import type { SectionMapping } from './section-folds';

interface Pending {
  readonly after: Text;
  readonly mapping: SectionMapping;
  readonly file: TFile;
  readonly path: string;
  active: boolean;
  done: (success: boolean) => void;
}
const pending = new WeakMap<EditorState, Pending>();
export const peerSectionMove = Annotation.define<boolean>();

function pendingFor(state: EditorState): Pending | undefined {
  const move = pending.get(state) ?? state.field(peerBinding, false);
  return move?.active ? move : undefined;
}
function sameContext(state: EditorState, move: Pending): boolean {
  return state.field(editorInfoField, false)?.file === move.file && move.file.path === move.path;
}
// Pure state propagation also handles multiple transactions constructed before a ViewUpdate.
// Relevant changes permanently remove the binding, even if a later transaction restores them.
const peerBinding = StateField.define<Pending | null>({
  create: () => null,
  update: (_value, tr) => {
    const move = pendingFor(tr.startState);
    return move && !tr.docChanged && sameContext(tr.state, move) && tr.startState.selection.eq(tr.newSelection, true)
      && sameFolds(readFolds(tr.startState), readFolds(tr.state)) ? move : null;
  },
});

/** Host file synchronization arrives later; unrelated effects retain the narrow binding. */
export const sectionPeerFilter: Extension = [peerBinding, EditorState.transactionFilter.of(tr => {
  const move = pendingFor(tr.startState);
  if (!move) return tr;
  if (!sameContext(tr.startState, move)) { move.done(false); return tr; }
  if (!tr.docChanged) return tr;
  if (!tr.newDoc.eq(move.after)) { move.done(false); return tr; }
  move.done(true);
  return [tr, { sequential: true, selection: mapSectionSelection(tr.startState.selection, move.mapping),
    effects: sectionMoveEffect.of(move.mapping), annotations: peerSectionMove.of(true) }];
})];

export class SectionPeers {
  private cleanups = new Set<() => void>();
  constructor(private views: () => readonly EditorView[], private diverged: () => void) {}
  arm(source: EditorView, before: Text, after: Text, mapping: SectionMapping): void {
    const file = fileFor(source);
    if (!file) return;
    for (const view of this.views()) {
      if (view === source || fileFor(view) !== file) continue;
      if (!view.state.doc.eq(before)) { this.diverged(); continue; }
      const state = view.state;
      let folds, selection;
      try { folds = mapSectionFolds(readFolds(state), mapping, after.length); selection = mapSectionSelection(state.selection, mapping); }
      catch { this.diverged(); continue; }
      const clear = () => {
        move.active = false; move.done = () => undefined;
        pending.delete(state); clearTimeout(timer); this.cleanups.delete(clear);
      };
      const done = (success: boolean) => {
        if (!move.active) return;
        clear();
        if (!success) this.diverged();
        else queueMicrotask(() => {
          if (!view.state.doc.eq(after) || !view.state.selection.eq(selection, true) || !sameFolds(readFolds(view.state), folds)) this.diverged();
        });
      };
      const timer = setTimeout(() => done(false), 2000);
      const move: Pending = { after, mapping, file, path: file.path, active: true, done };
      this.cleanups.add(clear);
      pending.set(state, move);
    }
  }
  update(update: ViewUpdate): void {
    const move = pendingFor(update.startState);
    if (move && pendingFor(update.state) !== move) move.done(false);
  }
  destroy(): void { for (const clear of this.cleanups) clear(); }
}
