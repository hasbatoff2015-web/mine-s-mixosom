import { describe, expect, it } from 'vitest';
import { REFERRAL_ACTIVE_SECONDS, REFERRAL_AFK_MS } from '../../shared/referral';
import { InviteeActivityClock } from '../../server/referral/activity';
import type { ActivitySample } from '../../server/referral/activity';

function sample(now: number, patch: Partial<ActivitySample> = {}): ActivitySample {
  return {
    now,
    x: 0,
    y: 64,
    z: 0,
    onGround: true,
    steered: false,
    dead: false,
    connected: true,
    epoch: 1,
    miningProgress: 0,
    ...patch,
  };
}

describe('referral activity clock', () => {
  it('credits wall time after a real action and caps an AFK gap at five minutes', () => {
    const clock = new InviteeActivityClock(0, 0);
    clock.mark(0, true);
    clock.observe(sample(60_000), true);
    expect(clock.pendingSeconds).toBe(60);
    clock.observe(sample(REFERRAL_AFK_MS + 60_000), true);
    expect(clock.pendingSeconds).toBe(REFERRAL_AFK_MS / 1000);
    clock.observe(sample(REFERRAL_AFK_MS + 10 * 60_000), true);
    expect(clock.pendingSeconds).toBe(REFERRAL_AFK_MS / 1000);
  });

  it('does not credit a held key, a camera turn, or external motion', () => {
    const held = new InviteeActivityClock(0, 0);
    for (let second = 1; second <= 600; second += 1) {
      held.observe(sample(second * 1000, { steered: true }), true);
    }
    expect(held.pendingSeconds).toBe(0);

    const look = new InviteeActivityClock(0, 0);
    look.observe(sample(0), true);
    look.observe(sample(120_000, { x: 0.1, z: 0.1 }), true);
    expect(look.pendingSeconds).toBe(0);

    const knockback = new InviteeActivityClock(0, 0);
    knockback.observe(sample(0), true);
    knockback.observe(sample(2_000, { x: 2, steered: false }), true);
    expect(knockback.pendingSeconds).toBe(0);

    const falling = new InviteeActivityClock(0, 0);
    falling.observe(sample(0, { y: 80, onGround: false }), true);
    falling.observe(sample(2_000, { y: 70, onGround: false, steered: true }), true);
    expect(falling.pendingSeconds).toBe(0);

    const teleport = new InviteeActivityClock(0, 0);
    teleport.mark(0, true);
    teleport.observe(sample(1_000, { x: 40, steered: true }), true);
    expect(teleport.pendingSeconds).toBeLessThanOrEqual(1);
    expect(teleport.totalSeconds).toBeLessThan(5);
  });

  it('stops while disconnected and does not count that gap after return', () => {
    const clock = new InviteeActivityClock(0, 0);
    clock.mark(0, true);
    clock.observe(sample(60_000), true);
    expect(clock.pendingSeconds).toBe(60);
    clock.observe(sample(10 * 60_000, { connected: false }), true);
    clock.mark(11 * 60_000, true);
    clock.observe(sample(12 * 60_000), true);
    expect(clock.pendingSeconds).toBeLessThan(3 * 60);
  });

  it('never grants more seconds than the wall clock, even if sampled often', () => {
    const clock = new InviteeActivityClock(0, 0);
    clock.mark(0, true);
    for (let index = 1; index <= 100; index += 1) {
      clock.observe(sample(index * 10, { x: index * 0.02, steered: true }), true);
    }
    expect(clock.pendingSeconds).toBeLessThanOrEqual(1);
    clock.mark(2 * 60 * 60 * 1000, true);
    expect(clock.pendingSeconds).toBe(REFERRAL_AFK_MS / 1000);
    expect(clock.totalSeconds).toBeLessThanOrEqual(REFERRAL_ACTIVE_SECONDS);
  });

  it('caps stored progress at three hours', () => {
    const clock = new InviteeActivityClock(REFERRAL_ACTIVE_SECONDS - 10, 0);
    clock.mark(0, true);
    clock.mark(60_000, true);
    expect(clock.totalSeconds).toBe(REFERRAL_ACTIVE_SECONDS);
    expect(clock.pendingSeconds).toBe(10);
  });
});
