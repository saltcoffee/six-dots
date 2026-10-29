import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnapshotCache } from '../src/editor/snapshot-cache';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('snapshot preparation lifecycle', () => {
  it('publishes only the newest document after rapid replacement', async () => {
    const cache = new SnapshotCache(), oldReady = vi.fn(), currentReady = vi.fn();
    cache.prepare('old document', oldReady);
    cache.prepare('new document\n\nsecond paragraph', currentReady);
    expect(cache.snapshot).toBeNull();
    await vi.runAllTimersAsync();
    expect(oldReady).not.toHaveBeenCalled();
    expect(currentReady).toHaveBeenCalledOnce();
    expect(cache.snapshot?.roots.map(block => block.text)).toEqual(['new document', 'second paragraph']);
  });

  it('cancels pending work and discards completed snapshots', async () => {
    const cache = new SnapshotCache(), ready = vi.fn();
    cache.prepare('pending', ready); cache.cancel();
    await vi.runAllTimersAsync();
    expect(ready).not.toHaveBeenCalled(); expect(cache.snapshot).toBeNull();
    cache.prepare('complete', ready); await vi.runAllTimersAsync();
    expect(ready).toHaveBeenCalledOnce(); expect(cache.snapshot?.text).toBe('complete');
    cache.cancel(); cache.cancel();
    expect(cache.snapshot).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
});
