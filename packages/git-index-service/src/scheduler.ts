/**
 * Minimal dependency-free scheduler. Either fires on a fixed interval
 * (GIT_INDEX_INTERVAL_MS) or once per day at a given local hour
 * (GIT_INDEX_DAILY_HOUR). Runs are serialized by the caller's guard.
 */
export class Scheduler {
    private timer: NodeJS.Timeout | null = null;
    private stopped = false;

    constructor(
        private task: () => Promise<unknown>,
        private opts: { intervalMs: number; dailyHour: number | null },
    ) {}

    private msUntilNextDailyRun(hour: number): number {
        const now = new Date();
        const next = new Date(now);
        next.setHours(hour, 0, 0, 0);
        if (next.getTime() <= now.getTime()) {
            next.setDate(next.getDate() + 1);
        }
        return next.getTime() - now.getTime();
    }

    private runGuarded(): void {
        Promise.resolve(this.task()).catch(err =>
            console.error('[Scheduler] Task error:', err?.message || err),
        );
    }

    start(): void {
        if (this.opts.dailyHour !== null) {
            const scheduleNext = () => {
                if (this.stopped) return;
                const delay = this.msUntilNextDailyRun(this.opts.dailyHour!);
                console.log(`[Scheduler] Next daily run in ${Math.round(delay / 60000)} min (at ${this.opts.dailyHour}:00)`);
                this.timer = setTimeout(() => {
                    this.runGuarded();
                    scheduleNext();
                }, delay);
            };
            scheduleNext();
        } else {
            console.log(`[Scheduler] Interval mode: every ${Math.round(this.opts.intervalMs / 60000)} min`);
            this.timer = setInterval(() => this.runGuarded(), this.opts.intervalMs);
        }
    }

    stop(): void {
        this.stopped = true;
        if (this.timer) {
            clearTimeout(this.timer);
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}
