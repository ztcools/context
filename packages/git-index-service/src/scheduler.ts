/**
 * Minimal dependency-free scheduler. Either fires on a fixed interval
 * (GIT_INDEX_INTERVAL_MS) or once per day at a given local hour
 * (GIT_INDEX_DAILY_HOUR). Supports live rescheduling so schedule edits from
 * the management UI take effect without a restart. Runs are serialized by the
 * caller's guard.
 */
export interface ScheduleOpts {
    intervalMs: number;
    dailyHour: number | null;
}

export class Scheduler {
    private timer: NodeJS.Timeout | null = null;
    private stopped = false;
    private nextRunAt: number | null = null;

    constructor(
        private task: () => Promise<unknown>,
        private opts: ScheduleOpts,
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

    private clearTimer(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    getNextRunAt(): number | null {
        return this.nextRunAt;
    }

    getSchedule(): ScheduleOpts {
        return { ...this.opts };
    }

    start(): void {
        this.stopped = false;
        this.clearTimer();
        if (this.opts.dailyHour !== null) {
            const scheduleNext = () => {
                if (this.stopped) return;
                const delay = this.msUntilNextDailyRun(this.opts.dailyHour!);
                this.nextRunAt = Date.now() + delay;
                console.log(`[Scheduler] Next daily run in ${Math.round(delay / 60000)} min (at ${this.opts.dailyHour}:00)`);
                this.timer = setTimeout(() => {
                    this.runGuarded();
                    scheduleNext();
                }, delay);
            };
            scheduleNext();
        } else {
            this.nextRunAt = Date.now() + this.opts.intervalMs;
            console.log(`[Scheduler] Interval mode: every ${Math.round(this.opts.intervalMs / 60000)} min`);
            this.timer = setInterval(() => {
                this.runGuarded();
                this.nextRunAt = Date.now() + this.opts.intervalMs;
            }, this.opts.intervalMs);
        }
    }

    /** Apply a new schedule live and restart the timer. */
    reschedule(opts: ScheduleOpts): void {
        this.opts = opts;
        this.start();
    }

    stop(): void {
        this.stopped = true;
        this.nextRunAt = null;
        this.clearTimer();
    }
}
