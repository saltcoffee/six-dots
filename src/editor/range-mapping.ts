import { ChangeSet, EditorSelection } from '@codemirror/state';
import type { ChangeDesc } from '@codemirror/state';
import type { RangeMove } from '../domain/range-move';
import type { SectionMapping } from './section-folds';
import type { ContentPiece } from './content-mapping';

/** Build local position descriptions cooperatively, without retaining source or candidate text. */
export function* rangeMappingSteps(move: RangeMove, changes: ChangeDesc): Generator<void, SectionMapping> {
  const edit = move.plan.edits[0]!;
  const pieces: ContentPiece[] = [];
  for (const piece of move.pieces) {
    pieces.push({ before: piece.before, after: piece.after,
      changes: ChangeSet.of([...(piece.edits ?? [])], piece.before.to - piece.before.from).desc });
    yield;
  }
  pieces.sort((a, b) => a.before.from - b.before.from);
  const before = { from: edit.from, to: edit.to };
  return { region: before, ranges: move.pieces, headings: [], content: {
    before, after: { from: edit.from, to: edit.from + edit.insert.length }, changes, pieces,
  } };
}

/** The moved group's complete range, keeping the original selection direction. */
export function rangeSelection(move: RangeMove, original: EditorSelection): EditorSelection {
  const source = original.main;
  const forward = source.anchor <= source.head;
  return EditorSelection.single(
    forward ? move.selectedAfter.from : move.selectedAfter.to,
    forward ? move.selectedAfter.to : move.selectedAfter.from,
  );
}
