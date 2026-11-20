import { Annotation, EditorState, StateField } from '@codemirror/state';
import type { Extension, Text } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import type { TFile } from 'obsidian';
import { fileFor } from './context';
import { timerHost } from './cooperative-task';
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
  private cleanups = new Map<EditorView, Set<() => void>>();
  private receipts = new Map<EditorView, (state: EditorState) => void>();
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
      const timers = timerHost(view);
      if (!timers) continue;
      let timer: number | null = null;
      const clear = () => {
        move.active = false; move.done = () => undefined;
        pending.delete(state);
        if (timer !== null) { timers.clearTimeout(timer); timer = null; }
        const viewCleanups = this.cleanups.get(view);
        viewCleanups?.delete(clear);
        if (viewCleanups?.size === 0) this.cleanups.delete(view);
      };
      const done = (success: boolean) => {
        if (!move.active) return;
        clear();
        if (!success) this.diverged();
        else {
          const verify = (received: EditorState) => {
            if (!received.doc.eq(after) || !received.selection.eq(selection, true) || !sameFolds(readFolds(received), folds)) this.diverged();
          };
          this.receipts.set(view, verify);
          queueMicrotask(() => {
            // A real ViewUpdate checks the received transaction itself. Later independent
            // transactions in the same turn must not invalidate that completed receipt.
            if (this.receipts.get(view) !== verify) return;
            this.receipts.delete(view); verify(view.state);
          });
        }
      };
      timer = timers.setTimeout(() => { timer = null; done(false); }, 2000);
      const move: Pending = { after, mapping, file, path: file.path, active: true, done };
      let viewCleanups = this.cleanups.get(view);
      if (!viewCleanups) { viewCleanups = new Set(); this.cleanups.set(view, viewCleanups); }
      viewCleanups.add(clear);
      pending.set(state, move);
    }
  }
  update(update: ViewUpdate): void {
    const verify = this.receipts.get(update.view);
    if (verify && update.transactions?.some(tr => tr.annotation(peerSectionMove))) {
      this.receipts.delete(update.view); verify(update.state);
    }
    const move = pendingFor(update.startState);
    if (move && pendingFor(update.state) !== move) move.done(false);
  }
  detach(view: EditorView): void {
    const viewCleanups = this.cleanups.get(view);
    if (viewCleanups) for (const clear of [...viewCleanups]) clear();
    this.receipts.delete(view);
  }
  destroy(): void {
    for (const viewCleanups of [...this.cleanups.values()]) for (const clear of [...viewCleanups]) clear();
    this.cleanups.clear(); this.receipts.clear();
  }
}
