/** One cancelable iterator, shared by parsing and complete move validation. */
export class CooperativeTask {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  start<T>(steps: Generator<void, T>, ready: (value: T) => void, failed?: (error: unknown) => void): void {
    this.cancel();
    const generation = this.generation;
    const advance = () => {
      if (generation !== this.generation) return;
      const deadline = performance.now() + 8;
      let result: IteratorResult<void, T>;
      try {
        do { result = steps.next(); } while (!result.done && performance.now() < deadline);
      } catch (error) { this.timer = null; failed?.(error); return; }
      if (result.done) { this.timer = null; ready(result.value); }
      else this.timer = setTimeout(advance, 0);
    };
    this.timer = setTimeout(advance, 0);
  }
  cancel(): void {
    this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
