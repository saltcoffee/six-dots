import { applyEdits, BlockError } from './block';
import type { Block, Plan, Reason, Snapshot, Span } from './block';
import type { BlockRange, RangeResolution, RangeUnit } from './block-range';
import { descendantCount, rangeReason, rangeTarget } from './block-range';
import { numberingStart, renumberBlock, sameNumbering } from './list-numbering';

/** A minimal edit inside one piece, in piece-local before-coordinates. */
export interface LocalEdit extends Span { readonly insert: string }
export interface Piece { readonly before: Span; readonly after: Span; readonly edits?: readonly LocalEdit[] }
export interface NumberingChange { readonly from: number; readonly before: number; readonly after: number }
export interface RangeMove {
  readonly source: BlockRange;
  readonly target: RangeUnit;
  readonly direction: -1 | 1;
  readonly plan: Plan;
  readonly selectedAfter: Span;
  readonly pieces: readonly Piece[];
  readonly numberingChanges: readonly NumberingChange[];
}

function kindSignature(values: readonly string[]): string {
  return [...values].sort().join('|');
}

function targetUnit(snapshot: Snapshot, block: Block): RangeUnit {
  return {
    from: block.from, to: block.to, block, kind: block.kind as RangeUnit['kind'], group: block.group,
    parentFrom: block.parentFrom ?? null, owned: block.owned ?? [{ from: block.from, to: block.to }],
    descendantCount: descendantCount(snapshot, block),
  };
}

/**
 * Character edits between two equal-line-count renderings of one item. Renumbering only changes the
 * marker on the first line and leading indentation on continuations, so a per-line prefix/suffix
 * diff yields exact local position mapping. Unequal line counts fall back to one whole replacement.
 */
function lineEdits(before: string, after: string): readonly LocalEdit[] | undefined {
  if (before === after) return undefined;
  const left = before.split('\n'), right = after.split('\n');
  if (left.length !== right.length) return [{ from: 0, to: before.length, insert: after }];
  const edits: LocalEdit[] = [];
  let offset = 0;
  for (let index = 0; index < left.length; index++) {
    const a = left[index]!, b = right[index]!;
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    let suffix = 0;
    while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
    if (a.slice(prefix, a.length - suffix) !== b.slice(prefix, b.length - suffix)) {
      edits.push({ from: offset + prefix, to: offset + a.length - suffix, insert: b.slice(prefix, b.length - suffix) });
    }
    offset += a.length + 1;
  }
  return edits.length ? edits : undefined;
}

interface Assembled { readonly replacement: string; readonly pieces: readonly Piece[]; readonly numbering: readonly NumberingChange[] }

function addItem(pieces: Piece[], numbering: NumberingChange[], item: Block, offset: number, number: number | null): { text: string; offset: number } {
  const text = number == null ? item.text : renumberBlock(item, number);
  if (number != null && item.marker?.number != null && number !== item.marker.number) {
    numbering.push({ from: item.from, before: item.marker.number, after: number });
  }
  const edits = number == null ? undefined : lineEdits(item.text, text);
  pieces.push({ before: { from: item.from, to: item.to }, after: { from: offset, to: offset + text.length }, ...(edits ? { edits } : {}) });
  return { text, offset: offset + text.length };
}

/** Reorder a complete source band, including its gaps; only the crossed gap stays at the boundary. */
function assemble(snapshot: Snapshot, slots: readonly Block[], units: readonly RangeUnit[], direction: -1 | 1,
  start: number | null, allSame: boolean): Assembled {
  const firstIndex = slots.indexOf(units[0]!.block);
  if (firstIndex < 0) throw new BlockError('unsafe');
  const parts: (Block | Span)[] = [];
  slots.forEach((block, index) => {
    if (index) parts.push({ from: slots[index - 1]!.to, to: block.from });
    parts.push(block);
  });
  const source = parts.slice(firstIndex * 2, (firstIndex + units.length) * 2 - 1);
  const targetIndex = direction < 0 ? firstIndex - 1 : firstIndex + units.length;
  const target = parts[targetIndex * 2]!;
  const gap = parts[direction < 0 ? firstIndex * 2 - 1 : (firstIndex + units.length) * 2 - 1]!;
  const window = direction < 0 ? [...source, gap, target] : [target, gap, ...source];
  parts.splice(Math.min(firstIndex, targetIndex) * 2, window.length, ...window);
  let replacement = '', offset = slots[0]!.from, itemIndex = 0;
  const pieces: Piece[] = [], numbering: NumberingChange[] = [];
  for (const part of parts) {
    if (!('kind' in part)) {
      const text = snapshot.text.slice(part.from, part.to);
      pieces.push({ before: part, after: { from: offset, to: offset + text.length } });
      replacement += text; offset += text.length;
      continue;
    }
    const number = start == null ? null : allSame ? start : start + itemIndex;
    const added = addItem(pieces, numbering, part, offset, number);
    replacement += added.text; offset = added.offset;
    itemIndex++;
  }
  return { replacement, pieces, numbering };
}

export function planRangeMove(snapshot: Snapshot, resolution: RangeResolution, direction: -1 | 1): RangeMove {
  const reason = rangeReason(resolution, direction, snapshot);
  if (reason) throw new BlockError(reason);
  const targetBlock = rangeTarget(resolution, direction)!;
  const units = resolution.range.units;
  const siblings = resolution.siblings;
  const numbered = resolution.range.group !== 'root'
    && siblings.every(block => block.kind === 'list-item' && block.marker !== null && block.marker.number !== null);
  let built: Assembled;
  let region: Span;
  try {
    if (numbered) {
      const start = numberingStart(siblings);
      built = assemble(snapshot, siblings, units, direction, start, start != null && sameNumbering(siblings, start));
      region = { from: siblings[0]!.from, to: siblings.at(-1)!.to };
    } else {
      const low = Math.min(siblings.indexOf(units[0]!.block), siblings.indexOf(targetBlock));
      const high = Math.max(siblings.indexOf(units.at(-1)!.block), siblings.indexOf(targetBlock));
      built = assemble(snapshot, siblings.slice(low, high + 1), units, direction, null, false);
      region = { from: Math.min(units[0]!.from, targetBlock.from), to: Math.max(units.at(-1)!.to, targetBlock.to) };
    }
  } catch (error) {
    if (numbered && error instanceof BlockError && error.reason === 'unsafe') throw new BlockError('rangeNumbering');
    throw error;
  }
  const byFrom = new Map(built.pieces.map(piece => [piece.before.from, piece]));
  const movedAfter = units.map(unit => byFrom.get(unit.from)!.after);
  const selectedAfter: Span = { from: Math.min(...movedAfter.map(span => span.from)), to: Math.max(...movedAfter.map(span => span.to)) };
  return {
    source: resolution.range, target: targetUnit(snapshot, targetBlock), direction,
    plan: { edits: [{ from: region.from, to: region.to, insert: built.replacement }], cursor: selectedAfter.from },
    selectedAfter, pieces: built.pieces, numberingChanges: built.numbering,
  };
}

export function* validateRangeMoveSteps(snapshot: Snapshot, move: RangeMove, candidate: Snapshot): Generator<void> {
  if (applyEdits(snapshot.text, move.plan.edits) !== candidate.text) throw new BlockError('unsafe');
  if (candidate.frontmatterEnd !== snapshot.frontmatterEnd) throw new BlockError('unsafe');
  if (kindSignature(candidate.roots.map(block => block.kind)) !== kindSignature(snapshot.roots.map(block => block.kind))) throw new BlockError('unsafe');
  if (kindSignature(candidate.blocks.map(block => block.kind)) !== kindSignature(snapshot.blocks.map(block => block.kind))) throw new BlockError('unsafe');
  if (candidate.headings.length !== snapshot.headings.length) throw new BlockError('unsafe');
  if (kindSignature(candidate.ids.map(id => id.value)) !== kindSignature(snapshot.ids.map(id => id.value))) throw new BlockError('unsafe');
  const selected = move.selectedAfter;
  if (move.source.group === 'root') {
    const roots = candidate.roots.filter(block => selected.from <= block.from && block.to <= selected.to);
    const expected = move.source.units.map(unit => unit.block.kind);
    if (roots.length !== expected.length || roots.some((block, index) => block.kind !== expected[index])) throw new BlockError('unsafe');
  } else {
    const within = (block: Block) => block.kind === 'list-item' && selected.from <= block.from && block.to <= selected.to;
    const top = candidate.blocks.filter(block => block.group === move.source.group && within(block));
    const all = candidate.blocks.filter(within);
    const expectedAll = move.source.units.reduce((sum, unit) => sum + 1 + unit.descendantCount, 0);
    if (top.length !== move.source.units.length || all.length !== expectedAll) throw new BlockError('unsafe');
  }
  yield;
}

export function validateRangeMove(snapshot: Snapshot, move: RangeMove, candidate: Snapshot): void {
  const steps = validateRangeMoveSteps(snapshot, move, candidate);
  while (!steps.next().done) { /* direct domain validation */ }
}

/** Lightweight availability: only the adjacent-target capability, never a full plan. */
export function rangeMoveReason(resolution: RangeResolution, direction: -1 | 1, snapshot: Snapshot): Reason | null {
  return rangeReason(resolution, direction, snapshot);
}
