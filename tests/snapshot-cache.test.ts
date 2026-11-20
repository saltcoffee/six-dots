import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnapshotCache } from '../src/editor/snapshot-cache';
import type { TimerHost } from '../src/editor/cooperative-task';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function makeWindowTimers() {
  let nextId = 1;
  const active = new Map<number, () => void>();
  const cleared: number[] = [];
  const host: TimerHost = {
    setTimeout(callback) {
      const id = nextId++;
      active.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      if (id !== undefined) {
        cleared.push(id);
        active.delete(id);
      }
    },
  };
  return {
    host,
    active,
    cleared,
    flush() {
      while (active.size > 0) {
        const entry = active.entries().next().value;
        if (!entry) break;
        const [id, fn] = entry;
        active.delete(id);
        fn();
      }
    },
  };
}

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

  it('clears timers only on the window that created them even when timer IDs collide', () => {
    const winA = makeWindowTimers(), winB = makeWindowTimers();
    const cacheA = new SnapshotCache(), cacheB = new SnapshotCache();
    const readyA = vi.fn(), readyB = vi.fn();

    cacheA.prepare('alpha', readyA, undefined, winA.host);
    cacheB.prepare('beta', readyB, undefined, winB.host);
    expect([...winA.active.keys()]).toEqual([1]);
    expect([...winB.active.keys()]).toEqual([1]);

    cacheA.cancel();
    expect(winA.cleared).toEqual([1]);
    expect(winA.active.size).toBe(0);
    expect(winB.cleared).toEqual([]);
    expect([...winB.active.keys()]).toEqual([1]);

    winB.flush();
    expect(readyA).not.toHaveBeenCalled();
    expect(readyB).toHaveBeenCalledOnce();
    expect(cacheB.snapshot?.text).toBe('beta');
  });
});
