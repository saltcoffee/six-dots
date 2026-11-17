import { EditorSelection } from '@codemirror/state';
import type { ChangeDesc, SelectionRange } from '@codemirror/state';
import { BlockError } from '../domain/block';
import type { Span } from '../domain/block';

export interface ContentPiece {
  readonly before: Span;
  readonly after: Span;
  readonly changes: ChangeDesc;
}

/** Text-free correspondence, shared by the source view, peers, and history. */
export interface ContentMapping {
  readonly before: Span;
  readonly after: Span;
  readonly changes: ChangeDesc;
  readonly pieces: readonly ContentPiece[];
}

export function invertContentMapping(mapping: ContentMapping): ContentMapping {
  return { before: mapping.after, after: mapping.before, changes: mapping.changes.invertedDesc,
    pieces: mapping.pieces.map(piece => ({ before: piece.after, after: piece.before, changes: piece.changes.invertedDesc }))
      .sort((a, b) => a.before.from - b.before.from) };
}

export function rebaseContentMapping(mapping: ContentMapping, changes: ChangeDesc): ContentMapping | undefined {
  if (changes.empty) return mapping;
  let touched = false;
  changes.iterChangedRanges((from, to) => {
    if (from < mapping.before.to && to > mapping.before.from
      || from === to && mapping.before.from <= from && from <= mapping.before.to) touched = true;
  });
  if (touched) return undefined;
  const after = changes.mapDesc(mapping.changes, true);
  const span = (range: Span, by: ChangeDesc) => ({ from: by.mapPos(range.from, 1), to: by.mapPos(range.to, -1) });
  return { before: span(mapping.before, changes), after: span(mapping.after, after), changes: mapping.changes.mapDesc(changes),
    pieces: mapping.pieces.map(piece => ({ before: span(piece.before, changes), after: span(piece.after, after), changes: piece.changes })) };
}

/** First piece whose end is after the position (or at it when the endpoint belongs to the left). */
function pieceIndex(mapping: ContentMapping, position: number, assoc = 1): number {
  let low = 0, high = mapping.pieces.length;
  while (low < high) {
    const mid = (low + high) >>> 1, end = mapping.pieces[mid]!.before.to;
    if (end < position || end === position && assoc >= 0) low = mid + 1;
    else high = mid;
  }
  return low;
}

function inPiece(piece: ContentPiece, position: number, assoc: number): number {
  const result = piece.after.from + piece.changes.mapPos(position - piece.before.from, assoc);
  if (result < piece.after.from || result > piece.after.to) throw new BlockError('rangeSelectionRoundTrip');
  return result;
}

function position(mapping: ContentMapping, at: number, assoc: number): number {
  if (at < mapping.before.from || at > mapping.before.to
    || at === mapping.before.from && assoc < 0 || at === mapping.before.to && assoc >= 0) {
    return mapping.changes.mapPos(at, assoc);
  }
  const piece = mapping.pieces[pieceIndex(mapping, at, assoc)];
  if (!piece || at < piece.before.from || at > piece.before.to) throw new BlockError('rangeSelectionRoundTrip');
  return inPiece(piece, at, assoc);
}

function selectedPieces(mapping: ContentMapping, range: SelectionRange): Span[] {
  const result: Span[] = [];
  if (range.from < mapping.before.from) result.push({ from: mapping.changes.mapPos(range.from, 1),
    to: mapping.changes.mapPos(Math.min(range.to, mapping.before.from), -1) });
  for (let i = pieceIndex(mapping, range.from); i < mapping.pieces.length; i++) {
    const piece = mapping.pieces[i]!;
    if (piece.before.from >= range.to) break;
    const from = Math.max(range.from, piece.before.from), to = Math.min(range.to, piece.before.to);
    if (from >= to) continue;
    const start = inPiece(piece, from, 1), end = inPiece(piece, to, -1);
    if (start >= end) throw new BlockError('rangeSelectionRoundTrip');
    result.push({ from: start, to: end });
  }
  if (range.to > mapping.before.to) result.push({ from: mapping.changes.mapPos(Math.max(range.from, mapping.before.to), 1),
    to: mapping.changes.mapPos(range.to, -1) });
  return result.sort((a, b) => a.from - b.from);
}

export function mapContentSelection(selection: EditorSelection, mapping: ContentMapping): EditorSelection {
  return EditorSelection.create(selection.ranges.map(range => {
    if (range.empty) return EditorSelection.cursor(position(mapping, range.head, range.assoc || 1), range.assoc,
      range.bidiLevel ?? undefined, range.goalColumn);
    const pieces = selectedPieces(mapping, range), first = pieces[0];
    if (!first) throw new BlockError('rangeSelectionRoundTrip');
    let end = first.to;
    for (const piece of pieces.slice(1)) {
      if (piece.from > end) throw new BlockError('rangeSelectionRoundTrip');
      end = Math.max(end, piece.to);
    }
    return EditorSelection.range(range.anchor < range.head ? first.from : end, range.anchor < range.head ? end : first.from,
      range.goalColumn, range.bidiLevel ?? undefined, range.assoc);
  }), selection.mainIndex);
}

export function mapContentFolds(folds: readonly Span[], mapping: ContentMapping): readonly Span[] {
  const result = folds.map(fold => {
    const owner = mapping.pieces[pieceIndex(mapping, fold.from)];
    let from: number, to: number;
    if (owner && owner.before.from <= fold.from && fold.to <= owner.before.to) {
      from = inPiece(owner, fold.from, 1); to = inPiece(owner, fold.to, -1);
    } else if (fold.to <= mapping.before.from || fold.from >= mapping.before.to
      || fold.from <= mapping.before.from && fold.to >= mapping.before.to) {
      from = mapping.changes.mapPos(fold.from, 1); to = mapping.changes.mapPos(fold.to, -1);
    } else throw new BlockError('unsafe');
    if (from < 0 || from >= to || to > mapping.changes.newLength) throw new BlockError('unsafe');
    return { from, to };
  });
  return result.sort((a, b) => a.from - b.from || a.to - b.to);
}
