import { Annotation, ChangeSet, EditorSelection, Transaction } from '@codemirror/state';
import type { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { foldEffect, foldedRanges, unfoldEffect } from '@codemirror/language';
import type { Plan, Snapshot, Span } from '../domain/block';
import { validateSectionMoveSteps } from '../domain/section';
import type { SectionMove } from '../domain/section';
import { validateRangeMoveSteps } from '../domain/range-move';
import type { RangeMove } from '../domain/range-move';
import type { MoveContext, Target } from './context';
import { contextValid, targetValid } from './context';
import { validateCandidate } from './dispatch';
import { SnapshotCache } from './snapshot-cache';
import { foldEffects, mapSectionFolds, readFolds, sameFolds, sectionCommit, sectionMappingSteps, sectionMoveEffect } from './section-folds';
import type { SectionMapping } from './section-folds';
import { rangeMappingSteps, rangeSelection } from './range-mapping';
import { CooperativeTask, timerHost } from './cooperative-task';

export interface PreparedMove {
  readonly target: MoveContext;
  readonly changes: ChangeSet;
  readonly expected: Text;
  readonly candidate: Snapshot;
  readonly selection: EditorSelection;
  readonly originalSelection: EditorSelection;
  readonly folds: readonly Span[];
  readonly originalFolds: readonly Span[];
  readonly mapping?: SectionMapping;
  /** True for the explicit multi-block action, which accepts one continuous non-empty selection. */
  readonly range?: boolean;
}
export const preparedMove = Annotation.define<PreparedMove>();
export const rangeSelectionRecorded = Annotation.define<PreparedMove>();

export class MovePreparation {
  private cache = new SnapshotCache();
  private task = new CooperativeTask();
  prepare(view: EditorView, target: MoveContext, plan: Plan, section: SectionMove | undefined,
    ready: (move: PreparedMove) => void, failed: (error: unknown) => void, range?: RangeMove): void {
    this.cancel();
    const changes = ChangeSet.of([...plan.edits], target.doc.length), expected = changes.apply(target.doc);
    const original = view.state, originalSelection = original.selection, originalFolds = readFolds(original);
    const validate = function* (cache: SnapshotCache): Generator<void, PreparedMove> {
      const candidate = cache.snapshot!;
      if (section) yield* validateSectionMoveSteps(target.snapshot, section, candidate);
      else if (range) yield* validateRangeMoveSteps(target.snapshot, range, candidate);
      else validateCandidate(target as Target, plan, changes, candidate);
      const mapping = section ? yield* sectionMappingSteps(section, candidate) : range ? yield* rangeMappingSteps(range, changes.desc) : undefined;
      // Legacy block moves retain native CM fold mapping; section and range moves bind folds to content.
      const selection = range ? rangeSelection(range, originalSelection) : EditorSelection.single(Math.min(plan.cursor, expected.length));
      let folds: readonly Span[];
      if (mapping) {
        folds = mapSectionFolds(originalFolds, mapping, expected.length);
      } else {
        const native: Span[] = [];
        foldedRanges(original).map(changes).between(0, expected.length, (from, to) => {
          if (!(from < selection.main.head && selection.main.head < to)) native.push({ from, to });
        });
        folds = native;
      }
      return { target, changes, expected, candidate, selection, originalSelection, originalFolds, folds, mapping, range: !!range };
    };
    const timers = timerHost(view);
    if (!timers) { failed(new Error('Window unavailable')); return; }
    this.cache.prepare(expected.toString(), () => this.task.start(validate(this.cache), ready, failed, timers), failed, timers, expected);
  }
  cancel(): void { this.cache.cancel(); this.task.cancel(); }
}

export type MoveResult = 'applied' | 'rejected' | 'diverged' | 'viewDiverged';
export function dispatchPrepared(view: EditorView, move: PreparedMove): MoveResult {
  const valid = move.range ? contextValid(view, move.target) : targetValid(view, move.target);
  if (!valid || !view.state.selection.eq(move.originalSelection, true)
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
    // Native history otherwise derives redo's selection through the replacement ChangeDesc.
    // A value-preserving selection event records the actual result in selectionsAfter without
    // creating another edit/undo item. Validate it before the sole document write.
    const recorded = move.range ? transaction.state.update({ selection: move.selection, userEvent: 'select',
      annotations: [rangeSelectionRecorded.of(move), isolateHistory.of('after')] }) : undefined;
    if (recorded && (recorded.startState !== transaction.state || !recorded.changes.empty || !recorded.selection?.eq(move.selection, true)
      || recorded.annotation(rangeSelectionRecorded) !== move || recorded.annotation(Transaction.addToHistory) === false
      || recorded.annotation(isolateHistory) !== 'after'
      || !recorded.newDoc.eq(move.expected) || !sameFolds(readFolds(recorded.state), folds))) return 'rejected';
    view.dispatch(transaction);
    if (!view.state.doc.eq(move.expected)) return view.state.doc.eq(before.doc) ? 'rejected' : 'diverged';
    if (!view.state.selection.eq(move.selection, true) || !sameFolds(readFolds(view.state), folds)) return 'viewDiverged';
    if (recorded) {
      if (recorded.startState !== view.state) return 'viewDiverged';
      view.dispatch(recorded);
      if (!view.state.doc.eq(move.expected)) return 'diverged';
      if (!view.state.selection.eq(move.selection, true) || !sameFolds(readFolds(view.state), folds)) return 'viewDiverged';
    }
    return 'applied';
  } catch (error) {
    if (!view.state.doc.eq(before.doc)) return view.state.doc.eq(move.expected) ? 'viewDiverged' : 'diverged';
    throw error;
  }
}
