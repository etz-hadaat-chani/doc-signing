/** Waits `ms` milliseconds. */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Keeps sends at most `perSecond` a second in this process (the provider's limit, e.g. AWS SES
 * 14/s): each call waits until at least `1000 / perSecond` ms have passed since the previous
 * one started. Calls queue up in order. One worker process sends every email, so this is the
 * system's limit too (3.10, PRD §13 "Bulk sending").
 */
export class SendRate {
  private readonly intervalMs: number;
  private next = 0;

  constructor(
    perSecond: number,
    private readonly now: () => number = Date.now,
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {
    this.intervalMs = 1000 / perSecond;
  }

  /** Resolves when this send may start. */
  async take(): Promise<void> {
    const now = this.now();
    const start = Math.max(now, this.next);
    this.next = start + this.intervalMs;
    if (start > now) await this.wait(start - now);
  }
}
