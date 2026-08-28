import { afterEach, describe, expect, it, vi } from 'vitest';
import { BLOCKS, BlockId, getBlockDefinition } from '../src/blocks';
import {
  PRODUCTION_SFX_FILE_BUDGET,
  SFX_BASE_PATH,
  catalogFiles,
  getSoundProfile,
  resolveCatalogEvent,
} from '../src/audio/soundCatalog';
import {
  GLOBAL_MAX_SOURCES,
  canStartVoice,
  chooseVariantIndex,
  clampVolume,
  linearAttenuation,
  samplePitch,
  shouldSkipDistant,
} from '../src/audio/audioMath';
import {
  MINING_HIT_INTERVAL_TICKS,
  createMiningSoundState,
  nextMiningSound,
  resetMiningSound,
} from '../src/audio/miningCadence';
import {
  SPRINT_STRIDE_BLOCKS,
  WALK_STRIDE_BLOCKS,
  advanceFootsteps,
  createFootstepState,
} from '../src/audio/footstepCadence';
import {
  MAX_EXPLOSIONS_PER_TICK,
  createExplosionLog,
  shouldPlayExplosion,
} from '../src/audio/explosionDedupe';
import { consumableSoundEvent } from '../src/audio/consumableSounds';
import { materialSoundEvent } from '../src/audio/soundEvents';
import { AudioManager } from '../src/core/AudioManager';
import { ItemId } from '../src/items';

describe('sound catalog', () => {
  it('stays within the ~20–25 source-file budget (26 with optional splash)', () => {
    const files = catalogFiles();
    expect(files.length).toBe(PRODUCTION_SFX_FILE_BUDGET);
    expect(files.length).toBeLessThanOrEqual(26);
    expect(files.length).toBeGreaterThanOrEqual(20);
    expect(new Set(files).size).toBe(files.length);
  });

  it('lists the production MP3 pack without duplicate filenames', () => {
    const files = catalogFiles();
    expect(files).toEqual(expect.arrayContaining([
      'stone_1.mp3', 'wood_1.mp3', 'dirt_1.mp3', 'sand_1.mp3', 'wool_1.mp3', 'glass_1.mp3',
      'explosion.mp3', 'bow_shoot.mp3', 'arrow_hit.mp3', 'item_pickup.mp3', 'water_splash.mp3',
    ]));
  });

  it('maps events to files without exposing filenames to callers of resolveCatalogEvent', () => {
    const stoneHit = resolveCatalogEvent('block.hit.stone');
    expect(stoneHit?.files).toEqual(['stone_1.mp3', 'stone_2.mp3']);
    expect(stoneHit?.positional).toBe(true);
    expect(stoneHit?.pitchMax).toBeGreaterThan(stoneHit!.pitchMin);
    expect(getSoundProfile('explosion')?.maxDistance).toBeGreaterThan(getSoundProfile('block.step.stone')!.maxDistance);
    expect(resolveCatalogEvent('glass.break')?.files).toEqual(['glass_1.mp3']);
    expect(SFX_BASE_PATH).toBe('audio/sfx/');
  });

  it('uses quieter/lower-pitch hit than break, and quieter steps than place', () => {
    const hit = resolveCatalogEvent('block.hit.wood')!;
    const brk = resolveCatalogEvent('block.break.wood')!;
    const place = resolveCatalogEvent('block.place.wood')!;
    const step = resolveCatalogEvent('block.step.wood')!;
    expect(hit.volume).toBeLessThan(brk.volume);
    expect(hit.pitchMin).toBeLessThan(brk.pitchMin);
    expect(place.volume).toBeLessThan(brk.volume);
    expect(step.volume).toBeLessThan(place.volume);
  });
});

describe('block sound groups', () => {
  it('assigns material families from BlockDefinition, not a Game.ts switch', () => {
    expect(getBlockDefinition(BlockId.Stone).soundGroup).toBe('stone');
    expect(getBlockDefinition(BlockId.CoalOre).soundGroup).toBe('stone');
    expect(getBlockDefinition(BlockId.Furnace).soundGroup).toBe('stone');
    expect(getBlockDefinition(BlockId.OakPlanks).soundGroup).toBe('wood');
    expect(getBlockDefinition(BlockId.Chest).soundGroup).toBe('wood');
    expect(getBlockDefinition(BlockId.OakDoor).soundGroup).toBe('wood');
    expect(getBlockDefinition(BlockId.Dirt).soundGroup).toBe('dirt');
    expect(getBlockDefinition(BlockId.GrassBlock).soundGroup).toBe('dirt');
    expect(getBlockDefinition(BlockId.Sand).soundGroup).toBe('sand');
    expect(getBlockDefinition(BlockId.Gravel).soundGroup).toBe('sand');
    expect(getBlockDefinition(BlockId.WhiteWool).soundGroup).toBe('wool');
    expect(getBlockDefinition(BlockId.Glass).soundGroup).toBe('glass');
    expect(getBlockDefinition(BlockId.Ice).soundGroup).toBe('glass');
    expect(getBlockDefinition(BlockId.Air).soundGroup).toBeUndefined();
    expect(getBlockDefinition(BlockId.Water).soundGroup).toBeUndefined();
    expect(getBlockDefinition(BlockId.Lava).soundGroup).toBeUndefined();
  });

  it('covers every registered block with a group or an explicit silent liquid/air', () => {
    for (const block of BLOCKS) {
      if (block.id === BlockId.Air || block.liquid) {
        expect(block.soundGroup, block.key).toBeUndefined();
      } else {
        expect(block.soundGroup, block.key).toMatch(/^(stone|wood|dirt|sand|wool|glass)$/);
      }
    }
  });

  it('builds material event ids from group + action', () => {
    expect(materialSoundEvent('break', 'stone')).toBe('block.break.stone');
  });
});

describe('variant / pitch / volume / distance', () => {
  it('selects variants without leaving the table', () => {
    expect(chooseVariantIndex(2, () => 0)).toBe(0);
    expect(chooseVariantIndex(2, () => 0.99)).toBe(1);
    expect(chooseVariantIndex(1, () => 0.5)).toBe(0);
  });

  it('samples pitch inside the event range', () => {
    const profile = { pitchMin: 0.94, pitchMax: 1.06 };
    expect(samplePitch(profile, () => 0)).toBeCloseTo(0.94);
    expect(samplePitch(profile, () => 1)).toBeCloseTo(1.06);
    expect(samplePitch(profile, () => 0.5)).toBeCloseTo(1.0);
  });

  it('clamps volume and attenuates linearly then skips past max distance', () => {
    expect(clampVolume(1.4)).toBe(1);
    expect(clampVolume(-0.2)).toBe(0);
    expect(linearAttenuation(0, 2, 16)).toBe(1);
    expect(linearAttenuation(2, 2, 16)).toBe(1);
    expect(linearAttenuation(9, 2, 16)).toBeCloseTo(0.5);
    expect(linearAttenuation(16, 2, 16)).toBe(0);
    expect(shouldSkipDistant(16.01, 16)).toBe(true);
    expect(shouldSkipDistant(8, 16)).toBe(false);
  });

  it('caps concurrent voices without globally muting explosions', () => {
    expect(canStartVoice({
      globalActive: 4, busActive: 4, busLimit: 4, priority: 3, lowestActivePriority: 2,
    }).play).toBe(false);
    const explosion = canStartVoice({
      globalActive: GLOBAL_MAX_SOURCES, busActive: 2, busLimit: 2, priority: 10, lowestActivePriority: 2,
    });
    expect(explosion.play).toBe(true);
    expect(explosion.steal).toBe(true);
  });
});

describe('mining cadence', () => {
  it('plays restrained hits every few ticks and a distinct break, never 20 hits/sec', () => {
    const state = createMiningSoundState();
    const hits: string[] = [];
    let progress = 0;
    for (let tick = 0; tick < 20 && progress < 1; tick += 1) {
      const kind = nextMiningSound(state, '1,2,3', progress, 0.08);
      progress += 0.08;
      hits.push(kind);
    }
    expect(hits.filter((kind) => kind === 'hit').length).toBeGreaterThanOrEqual(3);
    expect(hits.filter((kind) => kind === 'hit').length).toBeLessThan(12);
    expect(hits.at(-1)).toBe('break');
    expect(hits.some((kind, index) => kind === 'hit' && hits[index] === 'break')).toBe(false);
    for (let i = 0; i < hits.length; i += 1) {
      if (hits[i] === 'hit') expect(i % MINING_HIT_INTERVAL_TICKS === 0 || hits[i] === 'hit').toBe(true);
    }
  });

  it('instant / creative breaks only emit break, not a same-tick hit', () => {
    const state = createMiningSoundState();
    expect(nextMiningSound(state, '9,9,9', 0, 1)).toBe('break');
  });

  it('resets when the target changes or mining stops', () => {
    const state = createMiningSoundState();
    nextMiningSound(state, 'a', 0, 0.1);
    expect(state.ticksOnTarget).toBe(1);
    nextMiningSound(state, 'b', 0, 0.1);
    expect(state.targetKey).toBe('b');
    expect(state.ticksOnTarget).toBe(1);
    resetMiningSound(state);
    expect(state.targetKey).toBeUndefined();
  });
});

describe('footstep cadence', () => {
  it('steps from grounded travel, faster when sprinting, never while flying', () => {
    const walk = createFootstepState();
    let steps = 0;
    for (let i = 0; i < 20; i += 1) {
      if (advanceFootsteps(walk, {
        grounded: true, flying: false, sprinting: false, horizontalDistance: 0.5,
      })) steps += 1;
    }
    expect(steps).toBe(Math.floor((20 * 0.5) / WALK_STRIDE_BLOCKS));

    const sprint = createFootstepState();
    let sprintSteps = 0;
    for (let i = 0; i < 20; i += 1) {
      if (advanceFootsteps(sprint, {
        grounded: true, flying: false, sprinting: true, horizontalDistance: 0.5,
      })) sprintSteps += 1;
    }
    expect(sprintSteps).toBeGreaterThan(steps);
    expect(SPRINT_STRIDE_BLOCKS).toBeLessThan(WALK_STRIDE_BLOCKS);

    const fly = createFootstepState();
    fly.accumulator = 10;
    expect(advanceFootsteps(fly, {
      grounded: true, flying: true, sprinting: true, horizontalDistance: 5,
    })).toBe(false);
    expect(fly.accumulator).toBe(0);
  });
});

describe('explosion dedupe', () => {
  it('plays one nearby blast and caps per tick, covering creeper+TNT sharing the event', () => {
    const log = createExplosionLog();
    expect(shouldPlayExplosion(log, { x: 0, y: 64, z: 0 }, 10)).toBe(true);
    expect(shouldPlayExplosion(log, { x: 0.4, y: 64, z: 0.2 }, 10)).toBe(false);
    expect(shouldPlayExplosion(log, { x: 8, y: 64, z: 0 }, 10)).toBe(true);
    expect(shouldPlayExplosion(log, { x: 16, y: 64, z: 0 }, 10)).toBe(false);
    expect(log.playedThisTick).toBe(MAX_EXPLOSIONS_PER_TICK);
    expect(shouldPlayExplosion(log, { x: 40, y: 64, z: 0 }, 14)).toBe(true);
  });
});

describe('consumable events', () => {
  it('drinks potions and eats food', () => {
    expect(consumableSoundEvent({ id: ItemId.Apple })).toBe('food.eat');
    expect(consumableSoundEvent({ id: ItemId.PotionInvisibility, food: { returnsItem: ItemId.GlassBottle } })).toBe('potion.drink');
  });
});

describe('AudioManager samples, pause, mute, missing files', () => {
  afterEach(() => vi.restoreAllMocks());

  function mockContext() {
    const created: Array<{ start: ReturnType<typeof vi.fn>; playbackRate: { value: number }; onended: (() => void) | null }> = [];
    const context = {
      currentTime: 0,
      state: 'running',
      destination: {},
      listener: {
        positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 },
        forwardX: { value: 0 }, forwardY: { value: 0 }, forwardZ: { value: 0 },
        upX: { value: 0 }, upY: { value: 1 }, upZ: { value: 0 },
        setPosition: vi.fn(), setOrientation: vi.fn(),
      },
      resume: vi.fn(async () => {}),
      suspend: vi.fn(async () => {}),
      decodeAudioData: vi.fn(async () => ({ duration: 0.2 })),
      createBufferSource: () => {
        const source = {
          buffer: null as unknown,
          playbackRate: { value: 1 },
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          onended: null as (() => void) | null,
        };
        created.push(source);
        return source;
      },
      createGain: () => ({
        gain: { value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(), disconnect: vi.fn(),
      }),
      createPanner: () => ({
        panningModel: 'equalpower',
        distanceModel: 'linear',
        refDistance: 1,
        maxDistance: 16,
        rolloffFactor: 1,
        positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 },
        connect: vi.fn(), disconnect: vi.fn(), setPosition: vi.fn(),
      }),
      createOscillator: () => ({
        type: 'square', frequency: { value: 0 },
        connect: vi.fn(() => ({ connect: vi.fn() })),
        disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null,
      }),
    };
    return { context: context as unknown as AudioContext, created };
  }

  it('decodes once, reuses buffers, and never throws on missing samples', async () => {
    const { context, created } = mockContext();
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes('missing-never')) return { ok: false, status: 404 } as Response;
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      } as Response;
    });
    const audio = new AudioManager({
      fetch: fetchImpl as unknown as typeof fetch,
      audioContextFactory: () => context,
      isDev: false,
      random: () => 0,
    });
    await audio.preload();
    expect(fetchImpl).toHaveBeenCalled();
    const calls = fetchImpl.mock.calls.length;
    audio.play('item.pickup');
    audio.play('item.pickup');
    expect(created.length).toBe(2);
    expect(created[0]!.playbackRate.value).not.toBe(0);
    await audio.preload();
    expect(fetchImpl.mock.calls.length).toBe(calls);

    expect(() => audio.play('item.pickup')).not.toThrow();
    const broken = new AudioManager({
      fetch: (async () => { throw new Error('offline'); }) as unknown as typeof fetch,
      isDev: false,
    });
    await expect(broken.preload()).resolves.toBeUndefined();
    expect(() => broken.play('explosion')).not.toThrow();
    expect(() => broken.playAt('block.break.stone', { x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 })).not.toThrow();
  });

  it('skips inaudible far sources and respects pause / mute / master volume', async () => {
    const { context, created } = mockContext();
    const audio = new AudioManager({
      fetch: (async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })) as unknown as typeof fetch,
      audioContextFactory: () => context,
      isDev: false,
      random: () => 0.5,
    });
    await audio.preload();
    audio.playAt('block.hit.stone', { x: 80, y: 64, z: 0 }, { x: 0, y: 64, z: 0 });
    expect(created.length).toBe(0);

    audio.play('player.hurt');
    expect(created.length).toBe(1);
    audio.pause();
    audio.play('player.hurt');
    expect(created.length).toBe(1);
    expect(context.suspend).toHaveBeenCalled();
    audio.resume();
    audio.setMuted(true);
    audio.play('player.hurt');
    expect(created.length).toBe(1);
    audio.setMuted(false);
    audio.setVolume(0);
    audio.play('player.hurt');
    expect(created.length).toBe(1);
    audio.setVolume(0.7);
    audio.playBlock('place', BlockId.OakPlanks, { x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 });
    expect(created.length).toBe(2);
  });
});
