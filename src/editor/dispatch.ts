import { ChangeSet, EditorSelection } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { BlockError } from '../domain/block';
import type { Format, Plan } from '../domain/block';
import type { CommitResult } from '../application/extraction';
import { parseSnapshot } from './markdown';
import { targetValid } from './context';
import type { Target } from './context';

export function dispatchPlan(view: EditorView, target: Target, plan: Plan, format?: Format): CommitResult {
  if (!targetValid(view, target)) return 'rejected';
  const before = view.state.doc;
  try {
    const changes = ChangeSet.of([...plan.edits], before.length);
    const expected = changes.apply(before);
    const text = expected.toString();
    const candidate = parseSnapshot(text);
    if (text.slice(0, candidate.frontmatterEnd) !== target.snapshot.text.slice(0, target.snapshot.frontmatterEnd)) throw new BlockError('unsafe');
    const cursor = Math.min(plan.cursor, expected.length);
    if (format) {
      const result = candidate.blocks.find(block => block.from <= cursor && cursor <= block.contentTo);
      const kind = format.startsWith('h') ? 'heading' : format.startsWith('callout:') ? 'callout' : format === 'bullet' || format === 'task' ? 'list-item' : format;
      if (result?.kind !== kind) throw new BlockError('unsafe');
      if ((format === 'task' || format === 'bullet') && (!result.marker?.textRange || (format === 'task') !== (result.marker.task !== null))) throw new BlockError('unsafe');
    } else {
      // Reordering cannot change root structure or silently merge adjacent containers.
      const sorted = (values: readonly string[]) => [...values].sort().join('|');
      if (sorted(candidate.roots.map(block => block.kind)) !== sorted(target.snapshot.roots.map(block => block.kind))) {
        // Creating an ID may add a separately parsed native ID line, which the resolver attaches.
        if (!plan.edits.every(edit => edit.from === edit.to && /^\s*\^[A-Za-z0-9-]+$/.test(edit.insert))) throw new BlockError('unsafe');
      }
    }
    if (plan.createdId) {
      const owner = candidate.blocks.find(block => block.ownId?.value === plan.createdId && block.kind === target.block.kind && block.from === changes.mapPos(target.block.from, -1));
      if (!owner || owner.ambiguousIds) throw new BlockError('unsafe');
    }
    if (format || plan.createdId) {
      for (const owner of target.snapshot.blocks.filter(block => block.ownId && !block.ambiguousIds)) {
        const after = candidate.blocks.find(block => block.ownId?.value === owner.ownId?.value);
        if (!after || after.kind !== owner.kind || after.from !== changes.mapPos(owner.from, -1)) throw new BlockError('unsafe');
      }
    }
    const transaction = view.state.update({ changes, selection: EditorSelection.cursor(cursor), annotations: isolateHistory.of('full'), scrollIntoView: true });
    if (!transaction.newDoc.eq(expected) || transaction.startState !== view.state) return 'rejected';
    view.dispatch(transaction);
    if (!view.state.doc.eq(expected)) return view.state.doc.eq(before) ? 'rejected' : 'diverged';
    view.focus();
    return 'applied';
  } catch (error) {
    if (!view.state.doc.eq(before)) return 'diverged';
    if (error instanceof BlockError) throw error;
    return 'rejected';
  }
}
