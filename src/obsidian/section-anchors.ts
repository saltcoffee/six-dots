import { resolveSubpath, stripHeading, stripHeadingForLink } from 'obsidian';
import type { CachedMetadata, HeadingCache } from 'obsidian';
import type { Reason, Snapshot } from '../domain/block';
import { sectionReason } from '../domain/section';

const checked = new WeakMap<Snapshot, Reason | null>();

export function sectionAnchorReason(snapshot: Snapshot): Reason | null {
  if (checked.has(snapshot)) return checked.get(snapshot)!;
  let reason = sectionReason(snapshot);
  const keys = new Set<string>();
  if (!reason) for (const heading of snapshot.headings.filter(h => h.topLevel)) {
    // Both functions are public host APIs; no slug rules or stale file cache are used.
    const key = stripHeading(heading.title).toLowerCase();
    const cacheHeading: HeadingCache = { heading: heading.title, level: heading.level, position: {
      start: { line: 0, col: 0, offset: heading.from }, end: { line: 0, col: 0, offset: heading.to },
    } };
    const cache: CachedMetadata = { headings: [cacheHeading] };
    const result = resolveSubpath(cache, '#' + stripHeadingForLink(heading.title));
    if (keys.has(key) || result?.type !== 'heading' || result.current.position.start.offset !== heading.from) {
      reason = 'sectionAnchors'; break;
    }
    keys.add(key);
  }
  checked.set(snapshot, reason);
  return reason;
}
