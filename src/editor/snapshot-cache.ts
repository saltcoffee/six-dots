import type { Text } from '@codemirror/state';
import { frontmatterEnd, markdownParser, snapshotSteps } from './markdown';
import type { Snapshot } from '../domain/block';
import { CooperativeTask } from './cooperative-task';
import type { TimerHost } from './cooperative-task';

function* parseSteps(text: string): Generator<void, Snapshot> {
  const fm = frontmatterEnd(text);
  const masked = fm ? text.slice(0, fm).replace(/[^\n\r]/g, ' ') + text.slice(fm) : text;
  const parse = markdownParser.startParse(masked);
  let tree;
  while (!(tree = parse.advance())) yield;
  yield;
  return yield* snapshotSteps(text, tree);
}

/** Parse cooperatively outside pointer handlers; an incomplete tree can never produce an edit. */
export class SnapshotCache {
  snapshot: Snapshot | null = null;
  doc: Text | null = null;
  private task = new CooperativeTask();

  prepare(text: string, onReady: () => void, onError?: (error: unknown) => void, timers?: TimerHost | null, doc?: Text): void {
    this.snapshot = null;
    this.doc = null;
    this.task.start(parseSteps(text), snapshot => { this.snapshot = snapshot; this.doc = doc ?? null; onReady(); }, onError, timers);
  }

  cancel(): void {
    this.snapshot = null;
    this.doc = null;
    this.task.cancel();
  }

  adopt(snapshot: Snapshot, doc?: Text): void {
    this.cancel();
    this.snapshot = snapshot;
    this.doc = doc ?? null;
  }
}
