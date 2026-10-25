import { BlockError } from './block';
import type { Block, Format, Plan, Reason, Snapshot } from './block';

export function conversionReason(block: Block, format: Format): Reason | null {
  if (block.hasIds || block.ambiguousIds) return 'hasIds';
  if (block.kind === 'list-item') {
    if (block.marker?.number !== null) return 'unsupported';
    if (!block.marker?.textRange) return 'unsupported';
    if (block.marker?.task && ![' ', 'x', 'X'].includes(block.marker.task)) return 'customTask';
    return format === 'bullet' || format === 'task' ? null : 'unsupported';
  }
  if (block.kind === 'quote' || block.kind === 'callout') return format.startsWith('callout:') ? null : 'unsupported';
  if (!['paragraph', 'heading'].includes(block.kind)) return 'unsupported';
  return format.startsWith('h') && block.text.includes('\n') ? 'singleLine' : null;
}

export function convert(block: Block, format: Format, snapshot?: Snapshot, caret?: number): Plan | null {
  const reason = conversionReason(block, format);
  if (reason) throw new BlockError(reason);
  let replacement: string;
  if (block.kind === 'list-item' && block.marker) {
    const { indent, marker, spacing, task } = block.marker;
    if (format === 'task' && task !== null || format === 'bullet' && task === null) return null;
    const prefix = indent + marker + spacing;
    const body = block.text.slice(prefix.length);
    replacement = prefix + (format === 'task' ? '[ ] ' + body : body.replace(/^\[[ xX]\][ \t]*/, ''));
  } else if (block.kind === 'callout') {
    replacement = block.text.replace(/^(\s*>\s*\[!)[^\]]+(\])/, `$1${format.slice(8)}$2`);
  } else if (block.kind === 'quote') {
    replacement = `> [!${format.slice(8)}]\n${block.text}`;
  } else {
    let body = block.text;
    if (block.kind === 'heading') body = body.replace(/^ {0,3}#{1,6}(?:[ \t]+|$)/, '').replace(/^(?:#+[ \t]*)$|[ \t]+#+[ \t]*$/, '');
    if (format === 'paragraph') replacement = block.kind === 'paragraph' ? body : escapeBlockStart(body);
    else if (format.startsWith('h')) replacement = '#'.repeat(Number(format.slice(1))) + ' ' + body;
    else if (format === 'bullet' || format === 'task') {
      const lines = body.split('\n');
      replacement = (format === 'task' ? '- [ ] ' : '- ') + lines[0] + lines.slice(1).map(line => '\n  ' + line).join('');
    } else if (format === 'quote') replacement = body.split('\n').map(line => '> ' + line).join('\n');
    else replacement = `> [!${format.slice(8)}]\n` + body.split('\n').map(line => '> ' + line).join('\n');
  }
  if (replacement === block.text) return null;
  let before = '', after = '';
  if (snapshot && block.group === 'root' && !format.startsWith('h')) {
    const index = snapshot.roots.indexOf(block), previous = snapshot.roots[index - 1], next = snapshot.roots[index + 1];
    if (previous && (snapshot.text.slice(previous.to, block.from).match(/\n/g)?.length ?? 0) < 2) before = '\n';
    if (next && (snapshot.text.slice(block.to, next.from).match(/\n/g)?.length ?? 0) < 2) after = '\n';
  }
  const cursor = caret !== undefined && block.from <= caret && caret <= block.contentTo
    ? mappedCaret(block, format, replacement, caret - block.from) : replacement.length;
  return { edits: [{ from: block.from, to: block.to, insert: before + replacement + after }], cursor: block.from + before.length + cursor };
}

function mappedCaret(block: Block, format: Format, next: string, position: number): number {
  const oldLines = block.text.split('\n'), nextLines = next.split('\n');
  const preceding = block.text.slice(0, position).split('\n');
  const row = preceding.length - 1, column = preceding.at(-1)?.length ?? 0;
  const shift = format.startsWith('callout:') && block.kind !== 'callout' ? 1 : 0;
  const nextRow = Math.min(row + shift, nextLines.length - 1);
  const oldLine = oldLines[row] ?? '', nextLine = nextLines[nextRow] ?? '';
  let mapped = column;
  if (block.kind === 'callout') {
    let suffix = 0;
    while (suffix < oldLine.length && suffix < nextLine.length && oldLine.at(-suffix - 1) === nextLine.at(-suffix - 1)) suffix++;
    if (column >= oldLine.length - suffix) mapped += nextLine.length - oldLine.length;
  } else if (block.kind !== 'quote') {
    let oldPrefix = 0, nextPrefix = 0;
    if (row === 0 && block.kind === 'heading') oldPrefix = /^ {0,3}#{1,6}(?:[ \t]+|$)/.exec(oldLine)?.[0].length ?? 0;
    if (row === 0 && block.marker) oldPrefix = block.marker.indent.length + block.marker.marker.length + block.marker.spacing.length + (block.marker.task === null ? 0 : /^\[[ xX]\][ \t]*/.exec(oldLine.slice(block.marker.indent.length + block.marker.marker.length + block.marker.spacing.length))?.[0].length ?? 0);
    if (format.startsWith('h')) nextPrefix = Number(format.slice(1)) + 1;
    else if (format === 'task' || format === 'bullet') nextPrefix = row === 0 ? (block.marker?.indent.length ?? 0) + (block.marker?.marker.length ?? 1) + (block.marker?.spacing.length ?? 1) + (format === 'task' ? 4 : 0) : block.kind === 'paragraph' ? 2 : 0;
    else if (format === 'quote' || format.startsWith('callout:')) nextPrefix = 2;
    else if (format === 'paragraph' && block.kind === 'heading' && nextLine.startsWith('\\')) nextPrefix = 1;
    mapped = Math.max(0, column - oldPrefix) + nextPrefix;
  }
  const start = nextLines.slice(0, nextRow).reduce((length, line) => length + line.length + 1, 0);
  return start + Math.min(nextLine.length, Math.max(0, mapped));
}

function escapeBlockStart(text: string): string {
  return text.replace(/^( {0,3})(?:(#{1,6})(?=\s|$)|([>+*-])(?=\s|$)|(\d{1,9})([.)])(?=\s|$))/, (_all, indent: string, hashes: string, mark: string, digits: string, delimiter: string) => {
    if (digits) return `${indent}${digits}\\${delimiter}`;
    return `${indent}\\${hashes || mark}`;
  }).replace(/^( {0,3})(`{3,}|~{3,}|(?:[-*_][ \t]*){3,})$/, '$1\\$2');
}
