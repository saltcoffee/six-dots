import { BlockError } from './block';
import type { Block, Reason, Snapshot, Span } from './block';

/** A complete movable unit: one top-level container block or one list sibling subtree. */
export interface RangeUnit extends Span {
  readonly block: Block;
  readonly kind: 'paragraph' | 'quote' | 'callout' | 'code' | 'list-item';
  readonly group: string;
  readonly parentFrom: number | null;
  readonly owned: readonly Span[];
  readonly descendantCount: number;
}

export interface BlockRange extends Span {
  readonly group: string;
  readonly units: readonly RangeUnit[];
}

export interface RangeResolution {
  readonly range: BlockRange;
  /** The complete sibling sequence the units live in, barriers included. */
  readonly siblings: readonly Block[];
}

function ownSpans(block: Block): readonly Span[] {
  return block.owned && block.owned.length ? block.owned : [{ from: block.from, to: block.to }];
}

function touches(block: Block, from: number, to: number): boolean {
  return ownSpans(block).some(span => span.from < to && from < span.to);
}

function covers(outer: Block, inner: Block): boolean {
  return outer !== inner && outer.from <= inner.from && inner.to <= outer.to;
}

interface RangeIndex {
  readonly candidates: readonly Block[];
  readonly eligible: ReadonlySet<Block>;
  readonly groups: ReadonlyMap<string, readonly Block[]>;
  readonly positions: ReadonlyMap<Block, number>;
  readonly descendants: ReadonlyMap<Block, number>;
}
const indices = new WeakMap<Snapshot, RangeIndex>();

function indexFor(snapshot: Snapshot): RangeIndex {
  const cached = indices.get(snapshot);
  if (cached) return cached;
  const ordered = [...snapshot.blocks].sort((a, b) => a.from - b.from || b.to - a.to);
  const groups = new Map<string, Block[]>(), positions = new Map<Block, number>();
  const descendants = new Map<Block, number>();
  const stack: { block: Block; count: number }[] = [];
  let count = 0;
  const finish = () => { const entry = stack.pop()!; descendants.set(entry.block, count - entry.count); };
  for (const block of ordered) {
    while (stack.length && (block.from >= stack.at(-1)!.block.to || block.to > stack.at(-1)!.block.to)) finish();
    if (block.kind === 'list-item' && block.group !== 'root') count++;
    stack.push({ block, count });
    const group = groups.get(block.group) ?? [];
    positions.set(block, group.length); group.push(block); groups.set(block.group, group);
  }
  while (stack.length) finish();
  // Roots include barriers and are already in source order in a complete snapshot.
  groups.set('root', [...snapshot.roots]);
  snapshot.roots.forEach((block, position) => positions.set(block, position));
  const tables = [...snapshot.tableRanges].sort((a, b) => a.from - b.from);
  const candidates = ordered.filter(block => eligibleBlock(block, tables));
  const index = { candidates, eligible: new Set(candidates), groups, positions, descendants };
  indices.set(snapshot, index);
  return index;
}

export function descendantCount(snapshot: Snapshot, block: Block): number {
  return indexFor(snapshot).descendants.get(block) ?? 0;
}

function eligibleBlock(block: Block, tables: readonly Span[]): boolean {
  if (block.group === 'root') {
    if (!['paragraph', 'quote', 'callout', 'code'].includes(block.kind)) return false;
  } else if (block.kind !== 'list-item') return false;
  if (block.ambiguousIds || block.hasHeadings) return false;
  let low = 0, high = tables.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (tables[mid]!.to <= block.from) low = mid + 1;
    else high = mid;
  }
  return !tables[low] || tables[low]!.from >= block.to;
}

/** A unit is eligible only when it is a supported top-level container or a complete list item. */
export function unitEligible(snapshot: Snapshot, block: Block): boolean {
  return indexFor(snapshot).eligible.has(block);
}

function unitOf(snapshot: Snapshot, block: Block): RangeUnit {
  return {
    from: block.from, to: block.to, block,
    kind: block.kind as RangeUnit['kind'],
    group: block.group,
    parentFrom: block.group === 'root' ? null : block.parentFrom ?? null,
    owned: ownSpans(block),
    descendantCount: descendantCount(snapshot, block),
  };
}

/**
 * Resolve one plain half-open selection to the complete top-level block or list-sibling units it
 * touches. Direct content decides list-item membership; parent subtrees absorb descendants.
 */
export function resolveRange(snapshot: Snapshot, from: number, to: number): RangeResolution {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= to || to > snapshot.text.length) {
    throw new BlockError('rangeSelection');
  }
  // A heading, protected root, table, math or comment anywhere inside the plain selection rejects
  // the whole action; it is never silently dropped and the remaining blocks are not moved.
  if (from < snapshot.frontmatterEnd || snapshot.headings.some(heading => heading.from < to && from < heading.to)
    || snapshot.tableRanges.some(table => table.from < to && from < table.to)
    || snapshot.roots.some(block => block.kind === 'protected' && block.from < to && from < block.to)) {
    throw new BlockError('rangeProtected');
  }
  const index = indexFor(snapshot);
  const touched = index.candidates.filter(block => touches(block, from, to));
  const kept: Block[] = [];
  for (const block of touched) {
    // A touched parent owns its whole subtree; nested selections never add a second unit.
    if (kept.length && covers(kept.at(-1)!, block)) continue;
    kept.push(block);
  }
  if (!kept.length) throw new BlockError('rangeEmpty');
  if (kept.length === 1) throw new BlockError('rangeSingle');
  const group = kept[0]!.group;
  if (kept.some(block => block.group !== group)) throw new BlockError('rangeMixedGroups');
  const siblings = index.groups.get(group)!;
  const positions = kept.map(block => index.positions.get(block) ?? -1);
  if (positions.some(position => position < 0)) throw new BlockError('unsafe');
  const low = positions[0]!, high = positions.at(-1)!;
  if (high - low + 1 !== kept.length) {
    const selected = new Set(kept);
    const between = siblings.slice(low, high + 1).filter(block => !selected.has(block));
    throw new BlockError(between.some(block => !unitEligible(snapshot, block)) ? 'rangeProtected' : 'rangeMixedGroups');
  }
  const units = kept.map(block => unitOf(snapshot, block));
  return { range: { from: units[0]!.from, to: units.at(-1)!.to, group, units }, siblings };
}

/** The immediate sibling outside the range in one direction, or null when there is none. */
export function rangeTarget(resolution: RangeResolution, direction: -1 | 1): Block | null {
  const { range, siblings } = resolution;
  const index = direction < 0 ? siblings.findIndex(block => block.from === range.units[0]!.from)
    : siblings.findIndex(block => block.from === range.units.at(-1)!.from);
  if (index < 0) return null;
  return siblings[index + direction] ?? null;
}

export function rangeReason(resolution: RangeResolution, direction: -1 | 1, snapshot: Snapshot): Reason | null {
  const target = rangeTarget(resolution, direction);
  if (!target) return 'rangeNoSibling';
  if (!unitEligible(snapshot, target)) return 'rangeProtected';
  return null;
}
