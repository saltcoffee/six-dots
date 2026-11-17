import { actionable, BlockError, siblingBlocks } from './block';
import type { Block, Plan, Snapshot } from './block';
import { numberingStart, renumberBlock as renumber, sameNumbering } from './list-numbering';

export function move(snapshot: Snapshot, block: Block, target: Block, after: boolean): Plan | null {
  if (block.group !== target.group || !actionable(block)) throw new BlockError('unsafe');
  const siblings = [...siblingBlocks(snapshot, block)];
  const sourceIndex = siblings.indexOf(block), targetIndex = siblings.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0) throw new BlockError('unsafe');
  let insertion = targetIndex + (after ? 1 : 0);
  if (insertion === sourceIndex || insertion === sourceIndex + 1) return null;
  const reordered = [...siblings];
  reordered.splice(sourceIndex, 1);
  if (insertion > sourceIndex) insertion--;
  reordered.splice(insertion, 0, block);
  const low = Math.min(sourceIndex, insertion), high = Math.max(sourceIndex, insertion);
  const original = siblings.slice(low, high + 1), changed = reordered.slice(low, high + 1);
  const first = original[0], last = original.at(-1);
  if (!first || !last || first.from < snapshot.frontmatterEnd) throw new BlockError('unsafe');
  const ordered = block.marker?.number !== null && block.marker !== null;
  // A list's numbering is positional. Its item bodies must evolve independently of the markers.
  if (ordered) return moveOrdered(snapshot, siblings, reordered, block);
  const parts = changed.map(item => item.text);
  let replacement = parts[0] ?? '';
  let cursor = first.from + (changed[0] === block ? 0 : -1);
  for (let index = 1; index < parts.length; index++) {
    const left = original[index - 1], right = original[index];
    if (!left || !right) throw new BlockError('unsafe');
    const gap = block.group === 'root' ? '\n\n' : snapshot.text.slice(left.to, right.from);
    replacement += gap;
    if (changed[index] === block) cursor = first.from + replacement.length;
    replacement += parts[index];
  }
  return { edits: [{ from: first.from, to: last.to, insert: replacement }], cursor: Math.max(first.from, cursor) };
}

function moveOrdered(snapshot: Snapshot, original: readonly Block[], reordered: readonly Block[], source: Block): Plan {
  const first = original[0], last = original.at(-1);
  const start = numberingStart(original);
  if (!first || !last || start == null) throw new BlockError('unsafe');
  const allSame = sameNumbering(original, start);
  let replacement = '', cursor = first.from;
  reordered.forEach((item, index) => {
    if (index > 0) {
      const a = original[index - 1], b = original[index];
      if (!a || !b) throw new BlockError('unsafe');
      replacement += snapshot.text.slice(a.to, b.from);
    }
    if (item === source) cursor = first.from + replacement.length;
    replacement += renumber(item, allSame ? start : start + index);
  });
  return { edits: [{ from: first.from, to: last.to, insert: replacement }], cursor };
}

export function moveBy(snapshot: Snapshot, block: Block, direction: -1 | 1): Plan | null {
  if (!actionable(block)) throw new BlockError('unsafe');
  const siblings = siblingBlocks(snapshot, block);
  const index = siblings.indexOf(block), target = siblings[index + direction];
  return target ? move(snapshot, block, target, direction === 1) : null;
}
