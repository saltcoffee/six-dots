import { Annotation, ChangeSet, EditorSelection, Transaction } from '@codemirror/state';
import type { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { foldEffect, foldedRanges, unfoldEffect } from '@codemirror/language';
import type { Plan, Snapshot, Span } from '../domain/block';
import { validateSectionMoveSteps } from '../domain/section';
import type { SectionMove } from '../domain/section';
import type { Target } from './context';
import { targetValid } from './context';
import { validateCandidate } from './dispatch';
import { SnapshotCache } from './snapshot-cache';
import { foldEffects, mapSectionFolds, readFolds, sameFolds, sectionCommit, sectionMappingSteps, sectionMoveEffect } from './section-folds';
import type { SectionMapping } from './section-folds';
import { CooperativeTask } from './cooperative-task';

export interface PreparedMove {
  readonly target: Target;
  readonly changes: ChangeSet;
  readonly expected: Text;
  readonly candidate: Snapshot;
  readonly selection: EditorSelection;
  readonly originalSelection: EditorSelection;
  readonly folds: readonly Span[];
  readonly originalFolds: readonly Span[];
  readonly mapping?: SectionMapping;
}
export const preparedMove = Annotation.define<PreparedMove>();

export class MovePreparation {
  private cache = new SnapshotCache();
  private task = new CooperativeTask();
  prepare(view: EditorView, target: Target, plan: Plan, section: SectionMove | undefined,
    ready: (move: PreparedMove) => void, failed: (error: unknown) => void): void {
    this.cancel();
    const changes = ChangeSet.of([...plan.edits], target.doc.length), expected = changes.apply(target.doc);
    const original = view.state, originalSelection = original.selection, originalFolds = readFolds(original);
    const validate = function* (cache: SnapshotCache): Generator<void, PreparedMove> {
      const candidate = cache.snapshot!;
      if (section) yield* validateSectionMoveSteps(target.snapshot, section, candidate);
      else validateCandidate(target, plan, changes, candidate);
      const mapping = section ? yield* sectionMappingSteps(section, candidate) : undefined;
      // Legacy block moves retain native CM fold mapping; section moves bind folds to content.
      const selection = EditorSelection.single(Math.min(plan.cursor, expected.length));
      const folds: Span[] = [];
      if (!mapping) foldedRanges(original).map(changes).between(0, expected.length, (from, to) => {
        if (!(from < selection.main.head && selection.main.head < to)) folds.push({ from, to });
      });
      return { target, changes, expected, candidate, selection, originalSelection, originalFolds,
        folds: mapping ? mapSectionFolds(originalFolds, mapping, expected.length) : folds, mapping };
    };
    this.cache.prepare(expected.toString(), () => this.task.start(validate(this.cache), ready, failed), failed);
  }
  cancel(): void { this.cache.cancel(); this.task.cancel(); }
}

export type MoveResult = 'applied' | 'rejected' | 'diverged' | 'viewDiverged';
export function dispatchPrepared(view: EditorView, move: PreparedMove): MoveResult {
  if (!targetValid(view, move.target) || !view.state.selection.eq(move.originalSelection, true)
    || !sameFolds(readFolds(view.state), move.originalFolds)) return 'rejected';
  const before = view.state;
  try {
    const effects = move.mapping ? [...foldEffects(before, move.changes, move.folds), sectionMoveEffect.of(move.mapping)] : [];
    const spec = { changes: move.changes, selection: move.selection, effects,
      annotations: [isolateHistory.of('full'), preparedMove.of(move), ...(move.mapping ? [sectionCommit.of(true)] : [])], scrollIntoView: true };
    const folds = move.folds;
    const transaction = before.update(spec);
    if (transaction.startState !== view.state || !transaction.newDoc.eq(move.expected)
      || !transaction.newSelection.eq(move.selection, true) || transaction.annotation(preparedMove) !== move
      || transaction.annotation(isolateHistory) !== 'full' || transaction.annotation(Transaction.addToHistory) === false
      || move.mapping && transaction.annotation(sectionCommit) !== true
      || !effects.every(effect => transaction.effects.some(actual => {
        if (effect.is(sectionMoveEffect)) return actual.is(sectionMoveEffect) && actual.value === move.mapping;
        const type = effect.is(foldEffect) ? foldEffect : unfoldEffect;
        return actual.is(type) && actual.value.from === effect.value.from && actual.value.to === effect.value.to;
      }))
      || !sameFolds(readFolds(transaction.state), folds)) return 'rejected';
    view.dispatch(transaction);
    if (!view.state.doc.eq(move.expected)) return view.state.doc.eq(before.doc) ? 'rejected' : 'diverged';
    if (!view.state.selection.eq(move.selection, true) || !sameFolds(readFolds(view.state), folds)) return 'viewDiverged';
    return 'applied';
  } catch (error) {
    if (!view.state.doc.eq(before.doc)) return view.state.doc.eq(move.expected) ? 'viewDiverged' : 'diverged';
    throw error;
  }
}
