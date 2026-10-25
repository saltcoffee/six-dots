import { markdownParser, excludedInlineRanges } from '../editor/markdown';
import { applyEdits, BlockError } from '../domain/block';
import type { Edit } from '../domain/block';
import { wikiPathIsSafe } from '../domain/block-link';

export interface LinkTarget { readonly path: string }
export type ResolveLink = (path: string, source: string) => LinkTarget | null;

export function pointsToFile(link: string, source: string, expected: string, resolve: ResolveLink): boolean {
  const wiki = /^\[\[([^|\]]+)(?:\|[^\]]*)?\]\]$/.exec(link);
  let raw = wiki?.[1];
  if (!raw) {
    const node = markdownParser.parse(link).topNode.getChild('Paragraph')?.getChild('Link');
    const url = node?.getChild('URL');
    if (!url) return false;
    raw = link.slice(url.from, url.to).replace(/^<|>$/g, '');
  }
  if (raw.includes('#')) return false;
  try { return resolve(decodeURIComponent(raw), source)?.path === expected; } catch { return false; }
}

function relativePath(source: string, target: string): string {
  const parent = source.split('/').slice(0, -1), parts = target.split('/');
  while (parent.length && parts.length && parent[0] === parts[0]) { parent.shift(); parts.shift(); }
  return '../'.repeat(parent.length) + parts.join('/');
}

/** Link transport is separate from extraction: all offsets still refer to the original fragment. */
export function rewriteLinks(text: string, sourcePath: string, targetPath: string, resolve: ResolveLink): string {
  const excluded = excludedInlineRanges(text);
  const hidden = (from: number) => excluded.some(span => span.from <= from && from < span.to);
  const edits: Edit[] = [], wikiRanges: { from: number; to: number }[] = [];
  const forbidden = /\[\^[^\]]+\]|^[ \t]*\[[^\]]+\]:/gm;
  for (const match of text.matchAll(forbidden)) if (!hidden(match.index)) throw new BlockError('unsafe');

  function destination(raw: string): { path: string; anchor: string } | null {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) return null;
    const hash = raw.indexOf('#');
    const path = hash < 0 ? raw : raw.slice(0, hash), anchor = hash < 0 ? '' : raw.slice(hash);
    let decoded: string;
    try { decoded = decodeURIComponent(path); } catch { throw new BlockError('unsafe'); }
    const file = path ? resolve(decoded, sourcePath) : { path: sourcePath };
    if (!file) throw new BlockError('unsafe');
    return { path: file.path, anchor };
  }

  for (const match of text.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
    if (hidden(match.index)) continue;
    const bracket = match.index + (match[0].startsWith('!') ? 1 : 0);
    let escapes = 0;
    for (let at = bracket - 1; at >= 0 && text[at] === '\\'; at--) escapes++;
    if (escapes % 2) continue;
    const value = match[1] ?? '', split = value.indexOf('|');
    const raw = split < 0 ? value : value.slice(0, split), alias = split < 0 ? '' : value.slice(split);
    const file = destination(raw);
    if (!file || !wikiPathIsSafe(file.path)) throw new BlockError('unsafe');
    const path = file.path.endsWith('.md') ? file.path.slice(0, -3) : file.path;
    if (resolve(path, targetPath)?.path !== file.path) throw new BlockError('unsafe');
    const insert = `${match[0].startsWith('!') ? '!' : ''}[[${path}${file.anchor}${alias}]]`;
    edits.push({ from: match.index, to: match.index + match[0].length, insert });
    wikiRanges.push({ from: match.index, to: match.index + match[0].length });
  }
  markdownParser.parse(text).iterate({ enter(node) {
    if (hidden(node.from)) return false;
    if (node.name === 'HTMLTag' || node.name === 'HTMLBlock') throw new BlockError('unsafe');
    if (wikiRanges.some(span => span.from <= node.from && node.to <= span.to)) return false;
    if (node.name !== 'Link' && node.name !== 'Image') return;
    const url = node.node.getChild('URL');
    if (!url) throw new BlockError('unsafe');
    const raw = text.slice(url.from, url.to).replace(/^<|>$/g, '');
    const file = destination(raw);
    if (!file) return;
    const encoded = relativePath(targetPath, file.path).split('/').map(part => encodeURIComponent(part)).join('/');
    if (resolve(decodeURIComponent(encoded), targetPath)?.path !== file.path) throw new BlockError('unsafe');
    edits.push({ from: url.from, to: url.to, insert: encoded + file.anchor });
    // Nested images have their own URL spans and must be rebased as well as the enclosing link.
  } });
  return applyEdits(text, edits);
}
