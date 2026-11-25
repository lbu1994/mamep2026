/** Bounded runtime storage. Appending a sample does not copy prior samples. */
export class TraceBuffer<T> {
  private slots: Array<T | undefined>;
  private head = 0;
  private count = 0;
  private cached: readonly T[] | null = null;
  private capacity: number;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) {
      throw new RangeError("Trace capacity must be between 1 and 10000");
    }
    this.slots = new Array<T | undefined>(capacity);
    this.capacity = capacity;
  }

  get length(): number {
    return this.count;
  }

  push(sample: T): void {
    this.slots[(this.head + this.count) % this.capacity] = sample;
    if (this.count === this.capacity)
      this.head = (this.head + 1) % this.capacity;
    else this.count += 1;
    this.cached = null;
  }

  clear(): void {
    this.slots.fill(undefined);
    this.head = 0;
    this.count = 0;
    this.cached = null;
  }

  resize(capacity: number): void {
    const replacement = new TraceBuffer<T>(capacity);
    for (const sample of this.snapshot().slice(-capacity))
      replacement.push(sample);
    this.capacity = capacity;
    this.slots = replacement.slots;
    this.head = replacement.head;
    this.count = replacement.count;
    this.cached = null;
  }

  /** Copy only when a consumer requests a view; retain stable prior views. */
  snapshot(): readonly T[] {
    if (this.cached !== null) return this.cached;
    const samples: T[] = [];
    for (let offset = 0; offset < this.count; offset += 1) {
      const sample = this.slots[(this.head + offset) % this.capacity];
      if (sample !== undefined) samples.push(sample);
    }
    this.cached = Object.freeze(samples);
    return this.cached;
  }
}
