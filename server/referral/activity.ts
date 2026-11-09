import { REFERRAL_ACTIVE_SECONDS, REFERRAL_AFK_MS } from '../../shared/referral';

export const REFERRAL_MOVE_WINDOW_MS = 1_000;
export const REFERRAL_MOVE_HORIZONTAL = 0.6;
export const REFERRAL_TELEPORT_HORIZONTAL = 12;
export const REFERRAL_FLUSH_PENDING_MS = 45_000;
export const REFERRAL_OUTAGE_PENDING_MS = 60_000;

export interface ActivitySample {
  readonly now: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly onGround: boolean;
  readonly steered: boolean;
  readonly dead: boolean;
  readonly connected: boolean;
  readonly epoch: number;
  readonly miningProgress: number;
  readonly action?: boolean;
}

/**
 * In-memory active time for one accepted invite.
 * Credit is wall-clock time after a server-observed action, capped by the
 * AFK window and by the real elapsed milliseconds. It is not tick count.
 */
export class InviteeActivityClock {
  committedSeconds: number;
  pendingMs = 0;
  lastAccountedAt: number;
  lastMeaningfulAt: number | null = null;
  private lastX: number | null = null;
  private lastY: number | null = null;
  private lastZ: number | null = null;
  private windowStartedAt: number;
  private windowOriginX = 0;
  private windowOriginY = 0;
  private windowOriginZ = 0;
  private steeredInWindow = false;
  private epoch: number | null = null;
  private miningProgress: number | null = null;
  private windowOpen = false;

  constructor(committedSeconds: number, now: number) {
    this.committedSeconds = Math.max(0, Math.min(REFERRAL_ACTIVE_SECONDS, Math.floor(committedSeconds)));
    this.lastAccountedAt = now;
    this.windowStartedAt = now;
  }

  get pendingSeconds(): number {
    return Math.floor(this.pendingMs / 1000);
  }

  get totalSeconds(): number {
    return Math.min(REFERRAL_ACTIVE_SECONDS, this.committedSeconds + this.pendingSeconds);
  }

  get reachedGoal(): boolean {
    return this.committedSeconds + this.pendingMs / 1000 >= REFERRAL_ACTIVE_SECONDS;
  }

  shouldFlush(outage: boolean): boolean {
    if (this.reachedGoal && this.pendingMs >= 1000) return true;
    if (this.pendingMs >= REFERRAL_FLUSH_PENDING_MS) return true;
    if (outage && this.pendingMs >= 1000) return true;
    return false;
  }

  /** Drop a flush attempt from the local counter. The database value is adopted separately. */
  discardPendingSeconds(seconds: number): void {
    const ms = Math.max(0, Math.floor(seconds)) * 1000;
    this.pendingMs = Math.max(0, this.pendingMs - ms);
  }

  /** A confirmed gameplay action. Does not move the position window. */
  mark(now: number, allowCredit: boolean): void {
    if (!Number.isFinite(now)) return;
    if (!allowCredit) {
      this.lastAccountedAt = now;
      return;
    }
    this.accrue(now);
    this.lastMeaningfulAt = now;
  }

  observe(sample: ActivitySample, allowCredit: boolean): void {
    if (!Number.isFinite(sample.now)) return;
    if (!sample.connected || sample.dead || !allowCredit) {
      this.park(sample);
      return;
    }
    const teleported = this.epoch !== null && sample.epoch !== this.epoch;
    this.epoch = sample.epoch;
    if (teleported) this.openWindow(sample);

    const miningAdvanced = this.miningProgress !== null && sample.miningProgress > this.miningProgress + 0.001;
    this.miningProgress = sample.miningProgress;
    const moved = teleported ? false : this.consumeMovement(sample);
    const fresh = sample.action === true || miningAdvanced || moved;
    this.accrue(sample.now);
    if (fresh) this.lastMeaningfulAt = sample.now;
  }

  private park(sample: ActivitySample): void {
    this.lastAccountedAt = sample.now;
    this.epoch = sample.epoch;
    this.miningProgress = sample.miningProgress;
    this.openWindow(sample);
  }

  private openWindow(sample: ActivitySample): void {
    this.windowOpen = true;
    this.windowStartedAt = sample.now;
    this.windowOriginX = sample.x;
    this.windowOriginY = sample.y;
    this.windowOriginZ = sample.z;
    this.steeredInWindow = false;
    this.lastX = sample.x;
    this.lastY = sample.y;
    this.lastZ = sample.z;
  }

  private consumeMovement(sample: ActivitySample): boolean {
    if (!this.windowOpen || this.lastX === null) {
      this.openWindow(sample);
      this.steeredInWindow = sample.steered;
      return false;
    }
    if (sample.steered) this.steeredInWindow = true;
    const elapsed = sample.now - this.windowStartedAt;
    if (elapsed < REFERRAL_MOVE_WINDOW_MS) return false;
    const dx = sample.x - this.windowOriginX;
    const dy = sample.y - this.windowOriginY;
    const dz = sample.z - this.windowOriginZ;
    const horizontal = Math.hypot(dx, dz);
    const falling = !sample.onGround && Math.abs(dy) > 0.75 && horizontal < 0.35;
    const teleported = horizontal >= REFERRAL_TELEPORT_HORIZONTAL;
    const meaningful = this.steeredInWindow
      && !falling
      && !teleported
      && horizontal >= REFERRAL_MOVE_HORIZONTAL;
    this.openWindow(sample);
    return meaningful;
  }

  private accrue(now: number): void {
    if (now < this.lastAccountedAt) {
      this.lastAccountedAt = now;
      return;
    }
    const elapsed = now - this.lastAccountedAt;
    let credit = 0;
    if (this.lastMeaningfulAt !== null) {
      const creditUntil = this.lastMeaningfulAt + REFERRAL_AFK_MS;
      if (this.lastAccountedAt < creditUntil) {
        credit = Math.min(elapsed, creditUntil - this.lastAccountedAt);
      }
    }
    const roomMs = Math.max(0, REFERRAL_ACTIVE_SECONDS * 1000 - this.committedSeconds * 1000 - this.pendingMs);
    if (credit > 0 && roomMs > 0) this.pendingMs += Math.min(credit, roomMs);
    this.lastAccountedAt = now;
  }
}
