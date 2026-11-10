import { Annotation, EditorSelection, EditorState, StateEffect } from '@codemirror/state';
import type { ChangeDesc, Extension, Transaction } from '@codemirror/state';
import { foldedRanges, foldEffect, unfoldEffect } from '@codemirror/language';
import { invertedEffects } from '@codemirror/commands';
import { BlockError } from '../domain/block';
import type { Snapshot, Span } from '../domain/block';
import { mapSectionPosition, sectionSteps } from '../domain/section';
import type { RangeMapping, Section, SectionMove } from '../domain/section';

interface HeadingRange { readonly from: number; readonly headingTo: number; readonly to: number }
export interface SectionMapping {
  readonly ranges: readonly RangeMapping[];
  readonly headings: readonly { readonly before: HeadingRange; readonly after: HeadingRange }[];
  readonly region: Span;
}
export const historyFoldNotice = Annotation.define<boolean>();
export const sectionCommit = Annotation.define<boolean>();
const foldsMapped = Annotation.define<boolean>();

function rebase(mapping: SectionMapping, changes: ChangeDesc): SectionMapping | undefined {
  if (changes.empty) return mapping;
  let touched = false;
  changes.iterChangedRanges((from, to) => { if (from < mapping.region.to && to > mapping.region.from || from === to && from >= mapping.region.from && from <= mapping.region.to) touched = true; });
  if (touched) return undefined;
  const span = (range: Span) => ({ from: changes.mapPos(range.from, 1), to: changes.mapPos(range.to, -1) });
  const heading = (range: HeadingRange) => ({ ...span(range), headingTo: changes.mapPos(range.headingTo, -1) });
  return { region: span(mapping.region), ranges: mapping.ranges.map(m => ({ before: span(m.before), after: span(m.after) })),
    headings: mapping.headings.map(h => ({ before: heading(h.before), after: heading(h.after) })) };
}

export const sectionMoveEffect = StateEffect.define<SectionMapping>({ map: rebase });

export function invertSectionMapping(mapping: SectionMapping): SectionMapping {
  return { region: mapping.region, ranges: mapping.ranges.map(m => ({ before: m.after, after: m.before })),
    headings: mapping.headings.map(h => ({ before: h.after, after: h.before })) };
}

export function* sectionMappingSteps(move: SectionMove, candidate: Snapshot): Generator<void, SectionMapping> {
  const after = yield* sectionSteps(candidate), byFrom = new Map<number, Section>();
  for (const section of after) { yield; byFrom.set(section.from, section); }
  const describe = (s: Section): HeadingRange => ({ from: s.from, headingTo: s.heading.to, to: s.to });
  const headings: SectionMapping['headings'][number][] = [];
  for (const section of move.sections) {
    yield;
    if (!move.mappings.some(m => section.from >= m.before.from && section.from < m.before.to)) continue;
    const next = byFrom.get(mapSectionPosition(move.mappings, section.from));
    if (!next) throw new BlockError('sectionFold');
    headings.push({ before: describe(section), after: describe(next) });
  }
  const edit = move.plan.edits[0]!;
  return { region: { from: edit.from, to: edit.to }, ranges: move.mappings, headings };
}

export function sectionMapping(move: SectionMove, candidate: Snapshot): SectionMapping {
  const steps = sectionMappingSteps(move, candidate);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function readFolds(state: EditorState): readonly Span[] {
  const folds: Span[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => { folds.push({ from, to }); });
  return folds;
}

export function sameFolds(a: readonly Span[], b: readonly Span[]): boolean {
  return a.length === b.length && a.every((range, i) => range.from === b[i]?.from && range.to === b[i]?.to);
}

export function cursorHidden(state: EditorState): boolean {
  const folds = readFolds(state);
  return state.selection.ranges.some(r => folds.some(f => f.from < r.head && r.head < f.to));
}

export function mapSectionSelection(selection: EditorSelection, mapping: Pick<SectionMapping, 'ranges'>): EditorSelection {
  const ranges = [...mapping.ranges].sort((a, b) => a.before.from - b.before.from);
  const [first, last] = ranges;
  if (first && last) ranges.push({ before: { from: first.before.to, to: last.before.from }, after: { from: last.after.to, to: first.after.from } });
  return EditorSelection.create(selection.ranges.map(range => {
    if (range.empty) {
      const gap = ranges.at(-1)!;
      const head = gap.before.from < range.head && range.head < gap.before.to
        ? gap.after.from + range.head - gap.before.from : mapSectionPosition(mapping.ranges, range.head, true);
      return EditorSelection.cursor(head, range.assoc, range.bidiLevel ?? undefined, range.goalColumn);
    }
    const cuts = [range.from, ...ranges.flatMap(r => [r.before.from, r.before.to]).filter(p => range.from < p && p < range.to), range.to].sort((a, b) => a - b);
    const pieces: Span[] = [];
    for (let i = 1; i < cuts.length; i++) {
      const from = cuts[i - 1]!, to = cuts[i]!;
      if (from === to) continue;
      const owner = ranges.find(r => r.before.from <= from && to <= r.before.to);
      const shift = owner ? owner.after.from - owner.before.from : 0;
      pieces.push({ from: from + shift, to: to + shift });
    }
    pieces.sort((a, b) => a.from - b.from);
    const from = pieces[0]!.from;
    let to = pieces[0]!.to;
    for (const piece of pieces.slice(1)) {
      if (piece.from > to) throw new BlockError('sectionSelection');
      to = Math.max(to, piece.to);
    }
    return EditorSelection.range(range.anchor < range.head ? from : to, range.anchor < range.head ? to : from,
      range.goalColumn, range.bidiLevel ?? undefined, range.assoc);
  }), selection.mainIndex);
}

export function mapSectionFolds(folds: readonly Span[], mapping: SectionMapping, length: number): readonly Span[] {
  const byHeadingEnd = new Map(mapping.headings.map(h => [h.before.headingTo, h]));
  const result = folds.map(fold => {
    const heading = byHeadingEnd.get(fold.from);
    if (heading && heading.before.to - 1 <= fold.to && fold.to <= heading.before.to) {
      const to = heading.after.to === length ? length : heading.after.to - 1;
      if (to <= heading.after.headingTo) throw new BlockError('sectionFold');
      return { from: heading.after.headingTo, to };
    }
    const content = mapping.ranges.find(m => m.before.from <= fold.from && fold.to <= m.before.to);
    if (content) return { from: content.after.from + fold.from - content.before.from, to: content.after.from + fold.to - content.before.from };
    if (fold.to <= mapping.region.from || fold.from >= mapping.region.to || fold.from < mapping.region.from && fold.to >= mapping.region.to) return fold;
    throw new BlockError('sectionFold');
  });
  return result.sort((a, b) => a.from - b.from || a.to - b.to);
}

export function foldEffects(state: EditorState, changes: ChangeDesc, folds: readonly Span[]): readonly StateEffect<Span>[] {
  const effects: StateEffect<Span>[] = [];
  foldedRanges(state).map(changes).between(0, changes.newLength, (from, to) => { effects.push(unfoldEffect.of({ from, to })); });
  effects.push(...folds.map(fold => foldEffect.of(fold)));
  return effects;
}

export function transactionSectionMapping(transaction: Transaction): SectionMapping | undefined {
  return transaction.effects.find(effect => effect.is(sectionMoveEffect))?.value as SectionMapping | undefined;
}

export const sectionHistory: Extension = [
  invertedEffects.of(tr => {
    const mapping = transactionSectionMapping(tr);
    return mapping ? [sectionMoveEffect.of(invertSectionMapping(mapping))] : [];
  }),
  EditorState.transactionExtender.of(tr => {
    const mapping = transactionSectionMapping(tr);
    if (!mapping || tr.annotation(sectionCommit) || tr.annotation(foldsMapped)) return null;
    let folds: readonly Span[];
    try { folds = mapSectionFolds(readFolds(tr.startState), mapping, tr.newDoc.length); }
    catch (error) {
      if (!tr.isUserEvent('undo') && !tr.isUserEvent('redo')) throw error;
      return { annotations: [historyFoldNotice.of(true), foldsMapped.of(true)] };
    }
    const head = tr.newSelection.main.head;
    const visible = folds.filter(f => !(f.from < head && head < f.to));
    return { effects: foldEffects(tr.startState, tr.changes, visible), annotations: [historyFoldNotice.of(visible.length !== folds.length), foldsMapped.of(true)] };
  }),
];
