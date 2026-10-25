import { BlockError } from './block';
import type { Block, Plan } from './block';

// eslint-disable-next-line no-control-regex -- Portable filenames must reject ASCII controls, including DEL.
const controlCharacters = /[\x00-\x1f\x7f]/g;

export function extractionReason(block: Block): 'unsupported' | 'hasIds' | 'hasAnchors' | null {
  if (block.hasIds || block.ambiguousIds) return 'hasIds';
  if (block.hasHeadings) return 'hasAnchors';
  return ['paragraph', 'list-item'].includes(block.kind) ? null : 'unsupported';
}

export function extractedText(block: Block): string {
  const reason = extractionReason(block);
  if (reason) throw new BlockError(reason);
  const indent = block.marker?.indent ?? '';
  if (indent.includes('\t')) throw new BlockError('unsafe');
  return block.text.split('\n').map(line => {
    if (!line.trim()) return '';
    if (!line.startsWith(indent)) throw new BlockError('unsafe');
    return line.slice(indent.length);
  }).join('\n') + '\n';
}

export function extractionPlan(block: Block, link: string): Plan {
  const marker = block.marker;
  const prefix = marker ? marker.indent + marker.marker + marker.spacing + (marker.task === null ? '' : `[${marker.task}] `) : '';
  return { edits: [{ from: block.from, to: block.to, insert: prefix + link }], cursor: block.from + prefix.length + link.length };
}

export function targetPath(folder: string, name: string): string {
  const file = name.trim().replace(/\.md$/i, '');
  if (!file || /[\\/:*?"<>|#^[\]]/.test(file) || file.search(controlCharacters) >= 0 || /[. ]$/.test(file) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(file)) throw new BlockError('unsafe');
  if (folder.startsWith('/') || folder.includes('\\') || folder.split('/').some(part => ['.', '..'].includes(part))) throw new BlockError('unsafe');
  return [folder.replace(/\/$/, ''), `${file}.md`].filter(Boolean).join('/');
}

export function defaultName(text: string, fallbackPrefix = 'Note'): string {
  const title = text.split('\n')[0]?.replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[.\]\s*)?/, '').replace(/[\\/:*?"<>|#^[\]]/g, '').replace(controlCharacters, '').trim().slice(0, 60).replace(/[. ]+$/, '');
  if (title) return title;
  const now = new Date(), pad = (value: number) => String(value).padStart(2, '0');
  return `${fallbackPrefix} ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}
