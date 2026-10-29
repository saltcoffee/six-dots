export type BlockKind = 'paragraph' | 'heading' | 'list-item' | 'quote' | 'callout' | 'code' | 'list' | 'protected';
export type CalloutType = 'note' | 'info' | 'tip' | 'warning';
export type Format = 'paragraph' | `h${1 | 2 | 3 | 4 | 5 | 6}` | 'bullet' | 'task' | 'quote' | `callout:${CalloutType}`;
export interface Span { readonly from: number; readonly to: number }
export interface Edit extends Span { readonly insert: string }
export interface BlockId extends Span { readonly value: string }
export interface ListMarker {
  readonly indent: string;
  readonly marker: string;
  readonly spacing: string;
  readonly contentColumn: number;
  readonly number: number | null;
  readonly task: string | null;
  /** First direct paragraph/task; null when the item starts with another block. */
  readonly textRange: Span | null;
}
export interface Block extends Span {
  readonly kind: BlockKind;
  readonly group: string;
  readonly text: string;
  readonly contentTo: number;
  readonly ownId: BlockId | null;
  readonly hasIds: boolean;
  readonly ambiguousIds: boolean;
  readonly hasHeadings: boolean;
  readonly hasChildren: boolean;
  readonly marker: ListMarker | null;
}
export interface Snapshot {
  readonly text: string;
  readonly blocks: readonly Block[];
  readonly roots: readonly Block[];
  readonly tableRanges: readonly Span[];
  readonly frontmatterEnd: number;
}
export interface Plan { readonly edits: readonly Edit[]; readonly cursor: number; readonly createdId?: string }
export type Reason = 'unsupported' | 'hasIds' | 'hasAnchors' | 'customTask' | 'singleLine' | 'unsafe' | 'noSibling';
export class BlockError extends Error {
  constructor(readonly reason: Reason) { super(reason); }
}

export function actionable(block: Block): boolean {
  return !['protected', 'list'].includes(block.kind) && !block.ambiguousIds;
}

export function isTablePosition(snapshot: Snapshot, position: number): boolean {
  return snapshot.tableRanges.some(range => range.from <= position && position <= range.to);
}

export function atPosition(snapshot: Snapshot, position: number): Block | null {
  if (isTablePosition(snapshot, position)) return null;
  const block = snapshot.blocks.find(block => block.kind !== 'list' && block.from <= position && position <= block.contentTo);
  // A protected child must not fall through to an actionable ancestor.
  return block && actionable(block) ? block : null;
}

export function applyEdits(text: string, edits: readonly Edit[]): string {
  let result = '', previous = 0;
  for (const edit of [...edits].sort((a, b) => a.from - b.from)) {
    if (edit.from < previous || edit.to < edit.from || edit.to > text.length) throw new BlockError('unsafe');
    result += text.slice(previous, edit.from) + edit.insert;
    previous = edit.to;
  }
  return result + text.slice(previous);
}

export function siblingBlocks(snapshot: Snapshot, block: Block): readonly Block[] {
  return (block.group === 'root' ? snapshot.roots : snapshot.blocks).filter(item => item.group === block.group).sort((a, b) => a.from - b.from);
}
