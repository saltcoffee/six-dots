import { parser, GFM } from '@lezer/markdown';
import type { SyntaxNode, Tree } from '@lezer/common';
import type { Block, BlockId, BlockKind, ListMarker, Snapshot, Span } from '../domain/block';

export const markdownParser = parser.configure(GFM);

function lineStart(text: string, at: number): number { return text.lastIndexOf('\n', at - 1) + 1; }
function lineEnd(text: string, at: number): number { const end = text.indexOf('\n', at); return end < 0 ? text.length : end; }
function contentEnd(text: string, span: Span): number {
  let end = span.to;
  while (end > span.from && /[\n\r]/.test(text[end - 1] ?? '')) end--;
  return end;
}
function children(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

export function frontmatterEnd(text: string): number {
  if (!/^(?:\uFEFF)?---[ \t]*\r?\n/.test(text)) return 0;
  const end = /\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/g;
  end.lastIndex = text.indexOf('\n');
  const match = end.exec(text);
  return match ? match.index + match[0].length : text.length;
}

export function parseSnapshot(text: string, tree?: Tree): Snapshot {
  const fmEnd = frontmatterEnd(text);
  const masked = fmEnd ? text.slice(0, fmEnd).replace(/[^\n\r]/g, ' ') + text.slice(fmEnd) : text;
  const syntax = tree ?? markdownParser.parse(masked);
  const blocks: Block[] = [], roots: Block[] = [];
  const ids: BlockId[] = [];
  const definitions: Span[] = [];
  const headingSpans: Span[] = [];
  const nodeIds = new Map<number, BlockId>();
  const idListOwners = new Map<BlockId, number>();
  const rootNodes = children(syntax.topNode);
  const protectedRanges: Span[] = [];
  let delimiter: string | null = null, opening = 0, offset = 0;
  for (const line of text.split('\n')) {
    const end = offset + line.length;
    if (offset < fmEnd) { offset = end + 1; continue; }
    if (delimiter) {
      if (line.includes(delimiter)) { protectedRanges.push({ from: opening, to: end }); delimiter = null; }
    } else {
      let code = false;
      for (let node: SyntaxNode | null = syntax.resolveInner(Math.min(end, offset + line.search(/\S|$/)), 1); node; node = node.parent) {
        if (['FencedCode', 'CodeBlock', 'HTMLBlock'].includes(node.name)) code = true;
      }
      if (!code) {
        const token = /^\s*\$\$/.test(line) ? '$$' : line.includes('%%') ? '%%' : null;
        if (token) {
          if (line.indexOf(token, line.indexOf(token) + token.length) >= 0) protectedRanges.push({ from: offset, to: end });
          else { opening = offset; delimiter = token; }
        }
      }
    }
    offset = end + 1;
  }
  if (delimiter) protectedRanges.push({ from: opening, to: text.length });
  // The standard parser does not know Obsidian math/comments. Protect each enclosing root whole.
  const protectedRoots: Span[] = [];
  for (const span of protectedRanges) {
    const overlap = rootNodes.filter(node => node.from < span.to && node.to > span.from);
    const expanded = { from: Math.min(span.from, overlap[0]?.from ?? span.from), to: Math.max(span.to, overlap.at(-1)?.to ?? span.to) };
    const previous = protectedRoots.at(-1);
    if (previous && previous.to >= expanded.from) protectedRoots[protectedRoots.length - 1] = { from: previous.from, to: Math.max(previous.to, expanded.to) };
    else protectedRoots.push(expanded);
  }
  const excluded = (from: number, to: number) => protectedRoots.some(span => span.from < to && span.to > from);
  syntax.iterate({ enter(node) {
    if (node.name !== 'Document' && excluded(node.from, node.to)) return false;
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock'].includes(node.name)) return false;
    if (/^(ATX|Setext)Heading/.test(node.name)) headingSpans.push({ from: node.from, to: node.to });
    if (node.name === 'LinkReference' || /^\[\^[^\]]+\]:/.test(text.slice(node.from, lineEnd(text, node.from)))) definitions.push({ from: node.from, to: node.to });
    if (!['Paragraph', 'Task'].includes(node.name) && !/^ATXHeading[1-6]$/.test(node.name)) return;
    const match = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/.exec(text.slice(node.from, contentEnd(text, node)));
    if (!match) return;
    const from = node.from + match.index + match[0].indexOf('^');
    for (let n: SyntaxNode | null = syntax.resolveInner(from, 1); n && n.from >= node.from; n = n.parent) {
      if (n.name === 'InlineCode') return;
    }
    const id = { value: match[1] ?? '', from, to: from + (match[1]?.length ?? 0) + 1 };
    ids.push(id);
    nodeIds.set(node.from, id);
    for (let parent = node.node.parent; parent; parent = parent.parent) {
      if (parent.name === 'ListItem') { idListOwners.set(id, parent.from); break; }
    }
  } });
  const counts = new Map<string, number>();
  ids.forEach(id => counts.set(id.value, (counts.get(id.value) ?? 0) + 1));
  const duplicates = new Set([...counts].filter(([, count]) => count > 1).map(([value]) => value));

  function make(node: SyntaxNode, group: string, kind: BlockKind, marker: ListMarker | null = null): Block {
    const from = lineStart(text, node.from), to = contentEnd(text, node);
    const nestedIds = ids.filter(id => from <= id.from && id.to <= to);
    let ownId = kind === 'paragraph' ? nodeIds.get(node.from) ?? null : null;
    if (kind === 'list-item' && marker?.textRange) ownId = nodeIds.get(marker.textRange.from) ?? null;
    if (kind === 'quote' || kind === 'callout') {
      const last = children(node).at(-1);
      const id = last && ['Paragraph', 'Task'].includes(last.name) ? nodeIds.get(last.from) : undefined;
      if (id && nestedIds.length === 1) ownId = id;
    }
    const unclearListId = kind === 'list-item' && nestedIds.some(id => idListOwners.get(id) === node.from && id !== ownId);
    const unclearQuoteId = (kind === 'quote' || kind === 'callout') && nestedIds.length > 0 && !ownId;
    const block: Block = {
      from, to, contentTo: to, kind, group, marker, text: text.slice(from, to), ownId,
      hasIds: nestedIds.length > 0,
      ambiguousIds: unclearListId || unclearQuoteId || nestedIds.some(id => duplicates.has(id.value)),
      hasHeadings: headingSpans.some(heading => from <= heading.from && heading.to <= to),
      hasChildren: children(node).some(child => ['BulletList', 'OrderedList', 'Blockquote', 'FencedCode', 'CodeBlock'].includes(child.name)) || children(node).filter(child => ['Paragraph', 'Task'].includes(child.name)).length > 1,
    };
    blocks.push(block);
    return block;
  }

  function list(node: SyntaxNode): void {
    for (const item of children(node).filter(child => child.name === 'ListItem')) {
      const firstLine = text.slice(lineStart(text, item.from), lineEnd(text, item.from));
      const match = /^(\s*)([-+*]|\d{1,9}[.)])([ \t]+|$)(?:\[([^\]])\](?:[ \t]+|$))?/.exec(firstLine);
      if (!match) continue;
      const indent = match[1] ?? '', mark = match[2] ?? '', spacing = match[3] ?? '';
      const content = children(item).find(child => child.name !== 'ListMark');
      const textRange = content && ['Paragraph', 'Task'].includes(content.name) ? { from: content.from, to: contentEnd(text, content) } : null;
      const marker: ListMarker = { indent, marker: mark, spacing, contentColumn: indent.length + mark.length + spacing.length, number: /^\d/.test(mark) ? Number.parseInt(mark) : null, task: match[4] ?? null, textRange };
      // A child list on the same source line shares its parent's marker. Never expose a partial range.
      const compact = content && ['BulletList', 'OrderedList'].includes(content.name) && lineStart(text, content.from) === lineStart(text, item.from);
      make(item, `list:${node.from}`, compact ? 'protected' : 'list-item', marker);
      if (compact) continue;
      for (const child of children(item)) if (['BulletList', 'OrderedList'].includes(child.name)) list(child);
    }
  }

  for (const node of rootNodes) {
    if (excluded(node.from, node.to)) continue;
    const source = text.slice(node.from, contentEnd(text, node));
    if (/^\^[A-Za-z0-9-]+[ \t]*$/.test(source)) {
      const previous = roots.at(-1), id = nodeIds.get(node.from);
      if (previous && id && /^\s*$/.test(text.slice(previous.to, node.from))) {
        const known = ['quote', 'callout', 'list', 'code'].includes(previous.kind);
        const to = contentEnd(text, node);
        const updated: Block = { ...previous, to, text: text.slice(previous.from, to), ownId: known ? id : null, hasIds: true, ambiguousIds: !known || previous.ambiguousIds || duplicates.has(id.value) };
        roots[roots.length - 1] = updated;
        const at = blocks.indexOf(previous);
        if (at >= 0) blocks[at] = updated;
        continue;
      }
    }
    let kind: BlockKind = 'protected';
    if (node.name === 'Paragraph') kind = 'paragraph';
    if (/^ATXHeading[1-6]$/.test(node.name)) kind = 'heading';
    if (node.name === 'Blockquote') kind = /^\s*>\s*\[![^\]]+\]/.test(source) ? 'callout' : 'quote';
    if (node.name === 'FencedCode' && node.getChildren('CodeMark').length === 2) kind = 'code';
    if (['BulletList', 'OrderedList'].includes(node.name)) kind = 'list';
    if (source.startsWith('$$') || /^\[\^[^\]]+\]:/.test(source) || /^\^[A-Za-z0-9-]+\s*$/.test(source) || definitions.some(span => span.from >= node.from && span.from < node.to) && kind !== 'list') kind = 'protected';
    const block = make(node, 'root', kind);
    roots.push(block);
    if (kind === 'list') list(node);
  }
  for (const span of protectedRoots) {
    const block: Block = { ...span, contentTo: span.to, kind: 'protected', group: 'root', text: text.slice(span.from, span.to), ownId: null, hasIds: false, ambiguousIds: false, hasHeadings: false, hasChildren: false, marker: null };
    roots.push(block); blocks.push(block);
  }
  roots.sort((a, b) => a.from - b.from);
  // Children precede parents for hit testing, without changing their actual source ranges.
  blocks.sort((a, b) => (a.to - a.from) - (b.to - b.from));
  return { text, blocks, roots, frontmatterEnd: fmEnd };
}

export function excludedInlineRanges(text: string): readonly Span[] {
  const result: Span[] = [];
  markdownParser.parse(text).iterate({ enter(node) {
    if (['InlineCode', 'FencedCode', 'CodeBlock'].includes(node.name)) { result.push({ from: node.from, to: node.to }); return false; }
  } });
  return result;
}
