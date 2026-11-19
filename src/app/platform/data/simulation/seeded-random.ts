/** Small deterministic random source (mulberry32), so a seed always replays the same crowd. */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  between(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max], inclusive. */
  integer(min: number, max: number): number {
    return Math.floor(this.between(min, max + 1));
  }

  /** Index into `weights`, chosen in proportion to each weight. */
  weightedIndex(weights: readonly number[]): number {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let remaining = this.next() * total;
    for (let index = 0; index < weights.length; index++) {
      remaining -= weights[index];
      if (remaining < 0) {
        return index;
      }
    }
    return weights.length - 1;
  }
}
