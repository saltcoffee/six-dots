import { frontmatterEnd, markdownParser, snapshotSteps } from './markdown';
import type { Snapshot } from '../domain/block';
import { CooperativeTask } from './cooperative-task';

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
  private task = new CooperativeTask();

  prepare(text: string, onReady: () => void, onError?: (error: unknown) => void): void {
    this.snapshot = null;
    this.task.start(parseSteps(text), snapshot => { this.snapshot = snapshot; onReady(); }, onError);
  }

  cancel(): void {
    this.snapshot = null;
    this.task.cancel();
  }

  adopt(snapshot: Snapshot): void {
    this.cancel();
    this.snapshot = snapshot;
  }
}
