class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly timings = new Map<string, { count: number; totalMs: number; maxMs: number }>();

  public increment(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) || 0) + value);
  }

  public observe(name: string, durationMs: number): void {
    const current = this.timings.get(name) || { count: 0, totalMs: 0, maxMs: 0 };
    current.count += 1;
    current.totalMs += durationMs;
    current.maxMs = Math.max(current.maxMs, durationMs);
    this.timings.set(name, current);
  }

  public render(): string {
    const lines: string[] = [];
    for (const [name, value] of [...this.counters.entries()].sort()) {
      lines.push(`# TYPE ${name} counter`, `${name} ${value}`);
    }
    for (const [name, value] of [...this.timings.entries()].sort()) {
      lines.push(
        `# TYPE ${name}_milliseconds summary`,
        `${name}_milliseconds_count ${value.count}`,
        `${name}_milliseconds_sum ${value.totalMs}`,
        `${name}_milliseconds_max ${value.maxMs}`
      );
    }
    return `${lines.join('\n')}\n`;
  }
}

export const metrics = new MetricsService();
