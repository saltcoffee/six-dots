export interface TimerHost {
  setTimeout(handler: () => void, timeout?: number): number;
  clearTimeout(id?: number): void;
}

function isTimerHost(value: unknown): value is TimerHost {
  return typeof value === 'object' && value !== null
    && 'setTimeout' in value && typeof value.setTimeout === 'function'
    && 'clearTimeout' in value && typeof value.clearTimeout === 'function';
}

export function timerHost(view?: { dom?: { ownerDocument?: { defaultView?: unknown } } } | null): TimerHost | null {
  const doc = view?.dom?.ownerDocument;
  if (doc && doc.defaultView === null) return null;
  if (isTimerHost(doc?.defaultView)) return doc.defaultView;
  return globalThis as unknown as TimerHost;
}

/** One cancelable iterator, shared by parsing and complete move validation. */
export class CooperativeTask {
  private timer: { timers: TimerHost; id: number } | null = null;
  private generation = 0;

  start<T>(steps: Generator<void, T>, ready: (value: T) => void, failed?: (error: unknown) => void, timers: TimerHost | null = timerHost()): void {
    this.cancel();
    if (!timers) return;
    const generation = this.generation;
    const advance = () => {
      this.timer = null;
      if (generation !== this.generation) return;
      const deadline = performance.now() + 8;
      let result: IteratorResult<void, T>;
      try {
        do { result = steps.next(); } while (!result.done && performance.now() < deadline);
      } catch (error) { failed?.(error); return; }
      if (result.done) ready(result.value);
      else this.timer = { timers, id: timers.setTimeout(advance, 0) };
    };
    this.timer = { timers, id: timers.setTimeout(advance, 0) };
  }
  cancel(): void {
    this.generation++;
    if (this.timer) this.timer.timers.clearTimeout(this.timer.id);
    this.timer = null;
  }
}
