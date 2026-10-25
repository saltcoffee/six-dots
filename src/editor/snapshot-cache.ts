import { frontmatterEnd, markdownParser, parseSnapshot } from './markdown';
import type { Snapshot } from '../domain/block';
import type { PartialParse } from '@lezer/common';

/** Parse cooperatively outside pointer handlers; an incomplete tree can never produce an edit. */
export class SnapshotCache {
  snapshot: Snapshot | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  prepare(text: string, onReady: () => void): void {
    this.cancel();
    this.snapshot = null;
    const generation = this.generation;
    const fm = frontmatterEnd(text);
    const masked = fm ? text.slice(0, fm).replace(/[^\n\r]/g, ' ') + text.slice(fm) : text;
    const parse: PartialParse = markdownParser.startParse(masked);
    const advance = () => {
      if (generation !== this.generation) return;
      const deadline = performance.now() + 8;
      do {
        const tree = parse.advance();
        if (tree) { this.snapshot = parseSnapshot(text, tree); this.timer = null; onReady(); return; }
      } while (performance.now() < deadline);
      this.timer = setTimeout(advance, 0);
    };
    this.timer = setTimeout(advance, 0);
  }

  cancel(): void {
    this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
