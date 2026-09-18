export class RateLimit {
  private readonly entries = new Map<string, { count: number; until: number }>();
  public constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10000
  ) {}
  public allow(key: string, now = Date.now()): boolean {
    const existing = this.entries.get(key);
    if (existing && existing.until > now) return ++existing.count <= this.max;
    for (const [k, entry] of this.entries) if (entry.until <= now) this.entries.delete(k);
    if (this.entries.size >= this.maxKeys && !this.entries.has(key)) return false;
    this.entries.set(key, { count: 1, until: now + this.windowMs });
    return true;
  }
}
