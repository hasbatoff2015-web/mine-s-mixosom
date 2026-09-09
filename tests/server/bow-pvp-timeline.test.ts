import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createItemStack } from '../../src/inventory';
import { ItemId } from '../../src/items';
import { viewDirectionFromLook } from '../../src/player/localAim';
import type { BowReleaseAction } from '../../shared/playerActions';
import type { ClientInputMessage, ServerActionResultMessage } from '../../shared/protocol';
import { loadServerConfig } from '../../server/config';
import { MAX_PENDING_BOW_TICKS, MAX_PVP_REWIND_TICKS } from '../../server/combatPoseHistory';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';

class MemorySink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void { this.payloads.push(payload); }
}

function input(seq: number, extra: Partial<ClientInputMessage> = {}): ClientInputMessage {
  return {
    type: 'input', seq, forward: 0, right: 0, jump: false, sneak: false, sprint: false,
    descend: false, flySprint: false, yaw: 0, pitch: 0, selectedSlot: 0, use: false, mining: false,
    ...extra,
  };
}

function release(actionSeq: number, commandSeq: number, extra: Partial<BowReleaseAction> = {}): BowReleaseAction {
  return {
    kind: 'bow_release', actionSeq, commandSeq, selectedSlot: 0, yaw: 0, pitch: 0.45, ...extra,
  };
}

describe('sequenced bow release timeline', { timeout: 20_000 }, () => {
  const worlds: WorldInstance[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot() {
    const dir = await mkdtemp(join(tmpdir(), 'fc-bow-timeline-'));
    dirs.push(dir);
    const config = {
      ...loadServerConfig({
        HOST: '127.0.0.1', PORT: '0', WORLD: 'anarchy', WORLD_SEED: ANARCHY_WORLD_SEED,
        MAX_PLAYERS: '8', CHUNK_VIEW_RADIUS: '1', TICK_RATE: '20', PERSIST_INTERVAL_MS: '60000',
      }, process.cwd()),
      dataDir: dir, port: 0, chunkViewRadius: 1, persistIntervalMs: 60_000,
    };
    const world = new WorldInstance(config);
    worlds.push(world);
    await world.initialize();
    const sink = new MemorySink();
    const joined = world.join({ sink, name: 'Archer' });
    if ('error' in joined) throw new Error(joined.error);
    world.setGameMode(joined.player, 'survival');
    joined.player.inventory.clear();
    joined.player.inventory.setSlot(0, createItemStack(ItemId.Bow));
    joined.player.inventory.setSlot(1, createItemStack(ItemId.Arrow, 16));
    joined.player.controller.teleport([8.5, 72, 8.5]);
    world.applyInput(joined.player, input(1, { use: true }));
    expect(world.interact(joined.player, undefined, 1, 1, 0)).toEqual({ ok: true });
    world.tick();
    joined.player.bowUseTicks = 20;
    sink.payloads.length = 0;
    return { world, player: joined.player, sink };
  }

  function result(sink: MemorySink): ServerActionResultMessage | undefined {
    return [...sink.payloads].reverse().find((payload: unknown): payload is ServerActionResultMessage => (
      typeof payload === 'object' && payload !== null
      && (payload as { type?: string }).type === 'action_result'
      && (payload as { kind?: string }).kind === 'bow_release'
    ));
  }

  it('recovers post-physics boundary origin while preserving captured fast aim after later movement', async () => {
    const { world, player, sink } = await boot();
    world.applyInput(player, input(2, { use: false, forward: 1, yaw: -1.2, pitch: -0.2 }));
    world.tick();
    const boundary = player.combatPoseHistory.find((pose) => pose.commandSeq === 2)!;
    world.applyInput(player, input(3, { forward: 1, yaw: 2.1, pitch: 0.1 }));
    world.tick();
    const yaw = 0.73;
    const pitch = 0.18;
    world.handleSequencedBowRelease(player, release(2, 2, { yaw, pitch }));

    expect(result(sink)?.ok).toBe(true);
    const arrow = world.gameplay.arrows.entities.at(-1)!;
    const direction = viewDirectionFromLook(yaw, pitch);
    expect(arrow.position.x).toBeCloseTo(boundary.eyeX + direction.x * 0.35);
    expect(arrow.position.y).toBeCloseTo(boundary.eyeY + direction.y * 0.35);
    expect(arrow.position.z).toBeCloseTo(boundary.eyeZ + direction.z * 0.35);
    const actual = arrow.velocity.clone().normalize();
    expect(actual.x * direction.x + actual.y * direction.y + actual.z * direction.z).toBeGreaterThan(1 - 1e-6);
  });

  it('accepts action before a four-command backlog boundary without inflating charge', async () => {
    const { world, player, sink } = await boot();
    world.applyInput(player, input(2, { use: true }));
    world.applyInput(player, input(3, { use: true }));
    world.applyInput(player, input(4, { use: true }));
    world.applyInput(player, input(5, { use: false }));
    const received = world.tickNumber;
    world.handleSequencedBowRelease(player, release(2, 5, { renderTick: received - 3 }));
    world.tickCatchUp(4);

    const fired = result(sink);
    expect(fired?.ok).toBe(true);
    expect(fired?.bow).toMatchObject({
      receivedServerTick: received,
      pendingTicks: 4,
      receiveRewindTicks: 3,
      catchUpTicks: 4,
      authoritativeDrawTicks: 20,
      spawned: true,
    });
    expect(world.gameplay.arrows.entities.at(-1)?.playerTimelineTick).toBe(received - 3 + 4);
  });

  it('accepts an action that arrives after its release boundary and survives a later slot switch', async () => {
    const { world, player, sink } = await boot();
    world.applyInput(player, input(2, { use: false }));
    world.tick();
    world.applyInput(player, input(3, { selectedSlot: 1 }));
    world.tick();
    world.handleSequencedBowRelease(player, release(2, 2));
    expect(result(sink)?.ok).toBe(true);
    expect(world.gameplay.arrows.count).toBe(1);
  });

  it('accepts a render-frame release between input ticks from the latest authoritative boundary', async () => {
    const { world, player, sink } = await boot();
    world.handleSequencedBowRelease(player, release(2, 1, { yaw: 0.31, pitch: -0.12 }));
    expect(result(sink)?.ok).toBe(true);
    expect(result(sink)?.bow?.authoritativeDrawTicks).toBe(20);
    expect(world.gameplay.arrows.count).toBe(1);
    expect(player.bowUseTicks).toBe(0);
  });

  it('rejects slot mismatch, future/too-old timelines, and duplicate damage/ammo side effects', async () => {
    const { world, player, sink } = await boot();
    const received = world.tickNumber;
    world.handleSequencedBowRelease(player, release(2, 2, { renderTick: received + 0.01 }));
    expect(result(sink)?.bow?.rejectReason).toBe('future');
    world.handleSequencedBowRelease(player, release(3, 2, { renderTick: received - MAX_PVP_REWIND_TICKS - 0.01 }));
    expect(result(sink)?.bow?.rejectReason).toBe('too_old');

    world.applyInput(player, input(2, { use: false }));
    world.tick();
    const arrowsBefore = player.inventory.count(ItemId.Arrow);
    world.handleSequencedBowRelease(player, release(4, 2, { selectedSlot: 1 }));
    expect(result(sink)?.reason).toBe('slot');
    world.handleSequencedBowRelease(player, release(5, 2));
    expect(result(sink)?.ok).toBe(true);
    world.handleSequencedBowRelease(player, release(5, 2));
    expect(result(sink)?.reason).toBe('duplicate');
    expect(world.gameplay.arrows.count).toBe(1);
    expect(player.inventory.count(ItemId.Arrow)).toBe(arrowsBefore - 1);
  });

  it('bounds an action that never receives its command boundary', async () => {
    const { world, player, sink } = await boot();
    world.handleSequencedBowRelease(player, release(2, 50));
    world.tickCatchUp(MAX_PENDING_BOW_TICKS + 1);
    expect(result(sink)).toMatchObject({ ok: false, reason: 'stale' });
    expect(result(sink)?.bow?.rejectReason).toBe('pending_timeout');
    expect(player.pendingBowReleases).toHaveLength(0);
  });
});
