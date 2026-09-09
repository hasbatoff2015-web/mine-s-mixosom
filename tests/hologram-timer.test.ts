import { describe, expect, it } from 'vitest';
import rendererSource from '../src/rendering/HologramRenderer.ts?raw';
import uiSource from '../src/ui/GameUI.ts?raw';
import gameSource from '../src/core/Game.ts?raw';
import pluginSource from '../server/builtin-plugins/holograms.ts?raw';
import {
  formatHologramCountdown,
  hologramDisplayLines,
  hologramTimerRemainingSeconds,
  hologramWorldSize,
  parseHologramAppearanceLenient,
} from '../shared/hologramStyle';
import { hologramAabb } from '../src/gameplay/hologramHit';

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
