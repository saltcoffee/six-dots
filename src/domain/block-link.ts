import { BlockError } from './block';
import type { Block, Plan, Reason } from './block';

export function canonicalBlockLink(path: string, id: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(id) || !wikiPathIsSafe(path) || !path.endsWith('.md')) throw new BlockError('unsafe');
  return `[[${path.slice(0, -3)}#^${id}]]`;
}

export function wikiPathIsSafe(path: string): boolean {
  return !/[|#^\n\r]/.test(path) && !path.includes('[') && !path.includes(']');
}

export function blockLinkReason(block: Block): Reason | null {
  if (block.ambiguousIds) return 'unsafe';
  if (!['paragraph', 'list-item', 'quote', 'callout'].includes(block.kind)) return 'unsupported';
  if (!block.ownId && block.kind === 'list-item' && !block.marker?.textRange) return 'unsupported';
  return null;
}

export function addBlockId(block: Block, id: string): Plan {
  const reason = blockLinkReason(block);
  if (reason || block.ownId) throw new BlockError(reason ?? 'unsupported');
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new BlockError('unsafe');
  const at = block.kind === 'list-item' ? block.marker!.textRange!.to : block.to;
  const insert = block.kind === 'quote' || block.kind === 'callout' ? `\n\n^${id}` : ` ^${id}`;
  return { edits: [{ from: at, to: at, insert }], cursor: at, createdId: id };
}
