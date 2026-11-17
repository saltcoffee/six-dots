import { BlockError } from './block';
import type { Block } from './block';

/** Ordered numbering is positional: keep the group start and its `.`/`)` form. */
export function numberingStart(original: readonly Block[]): number | null {
  const first = original[0]?.marker?.number;
  return first == null ? null : first;
}

export function sameNumbering(original: readonly Block[], start: number): boolean {
  return original.every(item => item.marker?.number === start);
}

/**
 * Rewrite one ordered item's marker. Digits may widen or narrow, so continuation lines and the
 * subtree shift by the same column delta. Tab indentation is rejected rather than guessed.
 */
export function renumberBlock(block: Block, number: number): string {
  const marker = block.marker;
  if (!marker || number > 999999999) throw new BlockError('unsafe');
  const nextMarker = `${number}${marker.marker.at(-1)}`;
  const delta = nextMarker.length - marker.marker.length;
  if (delta === 0 && marker.marker === nextMarker) return block.text;
  const lines = block.text.split('\n');
  lines[0] = marker.indent + nextMarker + marker.spacing + (lines[0] ?? '').slice(marker.indent.length + marker.marker.length + marker.spacing.length);
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (!line.trim()) continue;
    // Tab columns cannot be shifted by a character count; reject rather than corrupt code indentation.
    if (/^\s*\t/.test(line) || !line.startsWith(' '.repeat(marker.contentColumn))) throw new BlockError('unsafe');
    lines[index] = delta >= 0 ? ' '.repeat(delta) + line : line.slice(-delta);
  }
  return lines.join('\n');
}
