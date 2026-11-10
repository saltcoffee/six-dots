import { applyEdits, BlockError } from './block';
import type { Plan, Reason, Snapshot, Span } from './block';

export interface Heading extends Span {
  readonly level: number;
  readonly title: string;
  readonly topLevel: boolean;
  readonly atx: boolean;
  readonly plain: boolean;
}
export interface Section extends Span {
  readonly heading: Heading;
  readonly parent: number | null;
  readonly payloadTo: number;
  readonly childHeadingCount: number;
}
export interface RangeMapping { readonly before: Span; readonly after: Span }
export interface SectionMove {
  readonly source: Section;
  readonly target: Section;
  readonly sections: readonly Section[];
  readonly plan: Plan;
  readonly mappings: readonly RangeMapping[];
}

export function sectionReason(snapshot: Snapshot): Reason | null {
  if (snapshot.text.includes('\r')) return 'sectionBoundary';
  if (snapshot.headings.some(h => !h.plain || h.topLevel && !h.atx)) return 'sectionTitles';
  if (snapshot.blocks.some(block => block.ambiguousIds)) return 'sectionIds';
  return null;
}

const sectionCache = new WeakMap<Snapshot, readonly Section[]>();

export function* sectionSteps(snapshot: Snapshot): Generator<void, readonly Section[]> {
  const cached = sectionCache.get(snapshot);
  if (cached) return cached;
  const headings = snapshot.headings.filter(h => h.topLevel && h.atx);
  const stack: number[] = [];
  const parents: (number | null)[] = [], ends = headings.map(() => snapshot.text.length);
  for (const [index, heading] of headings.entries()) {
    yield;
    while (stack.length && headings[stack.at(-1)!]!.level >= heading.level) ends[stack.pop()!] = heading.from;
    parents.push(stack.at(-1) ?? null); stack.push(index);
  }
  const result: Section[] = [];
  for (const [index, heading] of headings.entries()) {
    yield;
    const to = ends[index]!;
    let low = 0, high = snapshot.roots.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (snapshot.roots[mid]!.from < to) low = mid + 1; else high = mid;
    }
    const last = snapshot.roots[low - 1];
    if (!last || last.from < heading.from || last.to > to) throw new BlockError('sectionBoundary');
    let childEnd = index + 1;
    while (childEnd < headings.length && headings[childEnd]!.from < to) childEnd++;
    result.push({ from: heading.from, to, heading, parent: parents[index]!, payloadTo: last.to, childHeadingCount: childEnd - index - 1 });
  }
  sectionCache.set(snapshot, result);
  return result;
}

export function sections(snapshot: Snapshot): readonly Section[] {
  const steps = sectionSteps(snapshot);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function moveSection(snapshot: Snapshot, from: number, direction: -1 | 1): SectionMove {
  const reason = sectionReason(snapshot);
  if (reason) throw new BlockError(reason);
  const all = sections(snapshot), index = all.findIndex(s => s.heading.from === from), source = all[index];
  if (!source) throw new BlockError('unsupported');
  const siblings = all.filter(s => s.parent === source.parent);
  const target = siblings[siblings.indexOf(source) + direction];
  if (!target || target.heading.level !== source.heading.level) throw new BlockError('sectionNoSibling');
  const [a, b] = source.from < target.from ? [source, target] : [target, source];
  if (a.to !== b.from || a.payloadTo > b.from || b.payloadTo > b.to) throw new BlockError('sectionBoundary');
  const separator = snapshot.text.slice(a.payloadTo, b.from);
  if (!/^[\t \n]*\n[\t \n]*$/.test(separator)) throw new BlockError('sectionBoundary');
  const first = snapshot.text.slice(a.from, a.payloadTo), second = snapshot.text.slice(b.from, b.payloadTo);
  const aAfter = a.from + second.length + separator.length;
  const mappings: readonly RangeMapping[] = [
    { before: { from: a.from, to: a.payloadTo }, after: { from: aAfter, to: aAfter + first.length } },
    { before: { from: b.from, to: b.payloadTo }, after: { from: a.from, to: a.from + second.length } },
  ];
  return { source, target, sections: all, mappings,
    plan: { edits: [{ from: a.from, to: b.payloadTo, insert: second + separator + first }], cursor: mapSectionPosition(mappings, source.from) } };
}

export function mapSectionPosition(mappings: readonly RangeMapping[], position: number, end = false): number {
  const match = mappings.find(m => m.before.from <= position && (position < m.before.to || end && position === m.before.to));
  return match ? match.after.from + position - match.before.from : position;
}

export function* validateSectionMoveSteps(snapshot: Snapshot, move: SectionMove, candidate: Snapshot): Generator<void> {
  if (sectionReason(candidate) || applyEdits(snapshot.text, move.plan.edits) !== candidate.text
    || snapshot.blocks.length !== candidate.blocks.length || snapshot.ids.length !== candidate.ids.length
    || snapshot.headings.length !== candidate.headings.length || snapshot.frontmatterEnd !== candidate.frontmatterEnd) throw new BlockError('sectionBoundary');
  const map = (at: number, end = false) => mapSectionPosition(move.mappings, at, end);
  const blocks = new Map<string, Snapshot['blocks'][number]>();
  for (const block of candidate.blocks) { yield; blocks.set(`${block.kind}:${block.from}:${block.to}`, block); }
  for (const original of snapshot.blocks) {
    yield;
    const next = blocks.get(`${original.kind}:${map(original.from)}:${map(original.to, true)}`);
    const group = original.group === 'root' ? 'root' : `list:${map(Number(original.group.slice(5)))}`;
    if (!next || next.text !== original.text || next.group !== group || next.ownId?.value !== original.ownId?.value
      || next.ambiguousIds !== original.ambiguousIds || next.hasIds !== original.hasIds || next.hasChildren !== original.hasChildren) throw new BlockError('sectionBoundary');
  }
  const ids = new Map<number, Snapshot['ids'][number]>();
  for (const id of candidate.ids) { yield; ids.set(id.from, id); }
  for (const id of snapshot.ids) {
    yield;
    const next = ids.get(map(id.from));
    if (next?.value !== id.value || next.to !== map(id.to, true)) throw new BlockError('sectionIds');
  }
  const after = yield* sectionSteps(candidate), byFrom = new Map<number, Section>();
  for (const section of after) { yield; byFrom.set(section.from, section); }
  for (const original of move.sections) {
    yield;
    const next = byFrom.get(map(original.from));
    const parent = original.parent === null ? null : map(move.sections[original.parent]!.from);
    if (!next || next.heading.title !== original.heading.title || next.heading.level !== original.heading.level
      || next.childHeadingCount !== original.childHeadingCount
      || (next.parent === null ? null : after[next.parent]!.from) !== parent) throw new BlockError('sectionBoundary');
  }
}

/** Direct domain callers and scheduled editor work consume the same validation rules. */
export function validateSectionMove(snapshot: Snapshot, move: SectionMove, candidate: Snapshot): void {
  const steps = validateSectionMoveSteps(snapshot, move, candidate);
  while (!steps.next().done) { /* direct domain validation */ }
}
