import { describe, expect, it } from 'vitest';
import rendererSource from '../src/rendering/HologramRenderer.ts?raw';
import canvasHelperSource from '../src/rendering/hologramTextCanvas.ts?raw';
import uiSource from '../src/ui/GameUI.ts?raw';
import gameSource from '../src/core/Game.ts?raw';
import pluginSource from '../server/builtin-plugins/holograms.ts?raw';
import {
  formatHologramCountdown,
  hologramDisplayLines,
  hologramSpriteHeight,
  hologramSpriteWidth,
  hologramTimerRemainingSeconds,
  hologramTextCanvasScale,
  hologramTextCanvasSize,
  hologramTextPhysicalSize,
  hologramWorldSize,
  parseHologramAppearanceLenient,
  HOLOGRAM_TEXT_LOGICAL_HEIGHT,
  HOLOGRAM_TEXT_LOGICAL_WIDTH,
  HOLOGRAM_TEXT_RESOLUTION_SCALE_MAX,
  HOLOGRAM_TEXT_RESOLUTION_SCALE_MIN,
} from '../shared/hologramStyle';
import { hologramAabb } from '../src/gameplay/hologramHit';
import { createHologramRecord, HologramNetwork, normalizeHologramRecord } from '../server/services/holograms';

describe('hologram timer countdown', () => {
  it('counts 60 → 59 → … → 0 then restarts at full duration', () => {
    const started = 1_000_000;
    expect(hologramTimerRemainingSeconds(60, started, started)).toBe(60);
    expect(hologramTimerRemainingSeconds(60, started, started + 1000)).toBe(59);
    expect(hologramTimerRemainingSeconds(60, started, started + 59_000)).toBe(1);
    expect(hologramTimerRemainingSeconds(60, started, started + 60_000)).toBe(0);
    expect(hologramTimerRemainingSeconds(60, started, started + 61_000)).toBe(60);
  });

  it('formats MM:SS below an hour and HH:MM:SS at or above an hour', () => {
    expect(formatHologramCountdown(10)).toBe('00:10');
    expect(formatHologramCountdown(60)).toBe('01:00');
    expect(formatHologramCountdown(8)).toBe('00:08');
    expect(formatHologramCountdown(3600)).toBe('01:00:00');
    expect(formatHologramCountdown(3661)).toBe('01:01:01');
  });

  it('lets clients joining at different times share the same remaining value', () => {
    const started = Date.parse('2026-09-09T12:00:00.000Z');
    const duration = 60;
    const playerA = hologramTimerRemainingSeconds(duration, started, started + 10_000);
    const playerB = hologramTimerRemainingSeconds(duration, started, started + 30_000);
    expect(playerA).toBe(50);
    expect(playerB).toBe(30);
    expect(formatHologramCountdown(playerA)).toBe('00:50');
    expect(formatHologramCountdown(playerB)).toBe('00:30');
  });

  it('renders timer holograms as countdown text and normal holograms as stored lines', () => {
    expect(hologramDisplayLines({
      kind: 'timer',
      lines: ['ignored'],
      timerDuration: 10,
      timerStartedAt: 0,
    }, 0)).toEqual(['00:10']);
    expect(hologramDisplayLines({
      kind: 'normal',
      lines: ['Hello'],
      timerDuration: 10,
      timerStartedAt: 0,
    }, 0)).toEqual(['Hello']);
  });

  it('counts an AutoMine deadline down to zero without restarting a local period', () => {
    const now = 1_000_000;
    const endsAt = now + 272_000;
    expect(hologramDisplayLines({
      kind: 'timer',
      lines: ['Обновление шахты через:'],
      timerDuration: 60,
      timerStartedAt: 0,
      timerEndsAt: endsAt,
    }, now)).toEqual(['Обновление шахты через: 04:32']);
    expect(hologramDisplayLines({
      kind: 'timer',
      lines: ['Обновление шахты через:'],
      timerDuration: 60,
      timerStartedAt: 0,
      timerEndsAt: endsAt,
    }, endsAt + 5_000)).toEqual(['Обновление шахты через: 00:00']);
    expect(hologramDisplayLines({
      kind: 'timer',
      lines: ['Обновление шахты через:'],
      timerDuration: 60,
      timerStartedAt: 0,
      timerEndsAt: null,
    }, now)).toEqual(['Обновление шахты: нет расписания']);
    expect(hologramDisplayLines({
      kind: 'normal',
      lines: ['Hello'],
      timerDuration: 60,
      timerStartedAt: 0,
    }, now)).toEqual(['Hello']);
  });
});

describe('hologram background extents', () => {
  it('uses a larger background than the text for hit testing', () => {
    const small = hologramWorldSize({
      lines: ['Hi'],
      size: 0.5,
      backgroundEnabled: true,
      backgroundWidth: 5,
      backgroundHeight: 2,
    });
    const textOnly = hologramWorldSize({
      lines: ['Hi'],
      size: 0.5,
      backgroundEnabled: false,
      backgroundWidth: 5,
      backgroundHeight: 2,
    });
    expect(small.width).toBe(5);
    expect(small.height).toBe(2);
    expect(textOnly.width).toBeLessThan(small.width);
    expect(textOnly.height).toBeLessThan(small.height);
    const box = hologramAabb({
      name: 'wide',
      x: 0,
      y: 70,
      z: 0,
      lines: ['Hi'],
      size: 0.5,
      backgroundEnabled: true,
      backgroundWidth: 5,
      backgroundHeight: 2,
    });
    expect(box.maxX - box.minX).toBe(5);
    expect(box.maxY - box.minY).toBe(2);
  });

  it('does not change stored background size when only text size is parsed independently', () => {
    const appearance = parseHologramAppearanceLenient({
      lines: ['A'],
      size: 2.5,
      backgroundWidth: 2.6,
      backgroundHeight: 0.77,
      backgroundEnabled: false,
    });
    expect(appearance.size).toBe(2.5);
    expect(appearance.backgroundWidth).toBe(2.6);
    expect(appearance.backgroundHeight).toBe(0.77);
    expect(appearance.backgroundEnabled).toBe(false);
  });
});

describe('hologram renderer contracts', () => {
  it('keeps a single HologramRenderer without sprites or camera-facing fixed rotation', () => {
    expect(rendererSource).not.toContain('THREE.Sprite');
    expect(rendererSource).not.toContain('TimerHologramRenderer');
    expect(rendererSource).not.toContain('FixedHologramRenderer');
    expect(rendererSource).toContain('visual.group.quaternion.copy(this.camera.quaternion)');
    expect(rendererSource).toContain('if (visual.billboard)');
    expect(rendererSource.indexOf('if (visual.billboard)')).toBeLessThan(
      rendererSource.indexOf('visual.group.quaternion.copy(this.camera.quaternion)'),
    );
    expect(rendererSource).toContain('setFromEuler');
    expect(rendererSource).toContain('background.visible = hologram.backgroundEnabled');
    expect(rendererSource).not.toContain("fillRect");
    expect(rendererSource).toContain('configureHologramTextTexture(texture)');
    expect(rendererSource).toContain('createHologramTextCanvas');
    expect(rendererSource).toContain('ensureHologramTextCanvasResolution');
    expect(rendererSource).not.toContain('NearestFilter');
    expect(rendererSource).toContain('setTransform');
    expect(rendererSource.split('new THREE.CanvasTexture').length - 1).toBe(1);
    expect(canvasHelperSource).toContain('texture.magFilter = THREE.LinearFilter');
    expect(canvasHelperSource).toContain('texture.minFilter = THREE.LinearMipmapLinearFilter');
    expect(canvasHelperSource).toContain('texture.generateMipmaps = true');
    expect(canvasHelperSource).not.toContain('NearestFilter');
  });

  it('does not send per-tick timer packets and exposes editor controls', () => {
    expect(gameSource).not.toMatch(/type: 'hologram_tick'/);
    expect(pluginSource).toContain("if (sub === 'reset')");
    expect(pluginSource).toContain('Эта голограмма не является таймером.');
    expect(uiSource).toContain('Тип голограммы');
    expect(uiSource).toContain('Время таймера');
    expect(uiSource).toContain('data-holo="bg"');
    expect(uiSource).toContain('Следовать за игроком');
    expect(uiSource).toContain('Закреплена');
    expect(uiSource).toContain('data-holo="cancel"');
    expect(uiSource).toContain('data-holo="save"');
    expect(uiSource).toContain('preview-bg');
  });
});

describe('hologram text canvas resolution', () => {
  it('uses a physical canvas larger than the logical size and clamps the scale', () => {
    const oneX = hologramTextCanvasSize(1);
    expect(oneX.scale).toBeGreaterThanOrEqual(HOLOGRAM_TEXT_RESOLUTION_SCALE_MIN);
    expect(oneX.scale).toBeLessThanOrEqual(HOLOGRAM_TEXT_RESOLUTION_SCALE_MAX);
    expect(oneX.width).toBe(HOLOGRAM_TEXT_LOGICAL_WIDTH * oneX.scale);
    expect(oneX.height).toBe(HOLOGRAM_TEXT_LOGICAL_HEIGHT * oneX.scale);
    expect(oneX.width).toBeGreaterThan(HOLOGRAM_TEXT_LOGICAL_WIDTH);
    expect(oneX.height).toBeGreaterThan(HOLOGRAM_TEXT_LOGICAL_HEIGHT);
    expect(hologramTextCanvasScale(2)).toBeGreaterThanOrEqual(hologramTextCanvasScale(1));
    expect(hologramTextCanvasScale(8)).toBe(HOLOGRAM_TEXT_RESOLUTION_SCALE_MAX);
    expect(hologramTextCanvasScale(0)).toBe(HOLOGRAM_TEXT_RESOLUTION_SCALE_MIN);
    expect(hologramTextCanvasSize(8).width).toBe(HOLOGRAM_TEXT_LOGICAL_WIDTH * HOLOGRAM_TEXT_RESOLUTION_SCALE_MAX);
    const nameplate = hologramTextPhysicalSize(512, 205, 1);
    expect(nameplate.scale).toBe(oneX.scale);
    expect(nameplate.width).toBe(512 * oneX.scale);
    expect(nameplate.height).toBe(205 * oneX.scale);
  });

  it('does not change world-space text size when the canvas is supersampled', () => {
    expect(hologramSpriteWidth(1)).toBe(2.6);
    expect(hologramSpriteHeight(1, 1)).toBeCloseTo(0.77);
    expect(rendererSource).toContain('hologramTextPlaneSize(');
    expect(rendererSource).toContain('hologram.backgroundWidth, hologram.backgroundHeight');
  });
});

describe('AutoMine hologram deadline', () => {
  it('follows nextResetAt and leaves ordinary timers alone', () => {
    const emitted: { name: string; kind: string; timerEndsAt?: number | null; lines: readonly string[] }[][] = [];
    const net = new HologramNetwork((list) => {
      emitted.push(list.map((entry) => ({
        name: entry.name,
        kind: entry.kind,
        timerEndsAt: entry.timerEndsAt,
        lines: entry.lines,
      })));
    });
    let pitEnds: number | null = 50_000;
    net.setAutomineSchedule((name) => (name === 'pit' ? pitEnds : undefined));
    const linked = createHologramRecord({ name: 'sign', worldId: 'anarchy', x: 1, y: 2, z: 3 });
    linked.kind = 'timer';
    linked.automine = 'pit';
    linked.lines = ['Обновление шахты через:'];
    const plain = createHologramRecord({ name: 'hello', worldId: 'anarchy', x: 0, y: 0, z: 0, lines: ['Hello'] });
    plain.kind = 'timer';
    plain.timerDuration = 60;
    plain.timerStartedAt = 1_000;
    net.upsert(linked);
    net.upsert(plain);
    const first = emitted.at(-1)!;
    expect(first.find((entry) => entry.name === 'sign')).toMatchObject({
      kind: 'timer',
      timerEndsAt: 50_000,
      lines: ['Обновление шахты через:'],
    });
    expect(first.find((entry) => entry.name === 'hello')?.timerEndsAt).toBeUndefined();
    const broadcasts = emitted.length;
    net.noteAutomineSchedule();
    expect(emitted.length).toBe(broadcasts);
    pitEnds = 90_000;
    net.noteAutomineSchedule();
    expect(emitted.at(-1)!.find((entry) => entry.name === 'sign')?.timerEndsAt).toBe(90_000);
    expect(emitted.at(-1)!.find((entry) => entry.name === 'hello')?.timerEndsAt).toBeUndefined();
    pitEnds = null;
    net.noteAutomineSchedule();
    expect(emitted.at(-1)!.find((entry) => entry.name === 'sign')?.timerEndsAt).toBeNull();
    const stored = net.listRecords().find((entry) => entry.name === 'sign');
    const restored = normalizeHologramRecord(JSON.parse(JSON.stringify(stored)));
    expect(restored?.automine).toBe('pit');
    expect(restored?.kind).toBe('timer');
    expect(restored?.lines).toEqual(['Обновление шахты через:']);
  });
});
