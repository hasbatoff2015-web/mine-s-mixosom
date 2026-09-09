import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOLOGRAM_APPEARANCE,
  HOLOGRAM_FONT_DEFAULT,
  HOLOGRAM_SIZE_DEFAULT,
  HOLOGRAM_SIZE_MAX,
  HOLOGRAM_SIZE_MIN,
  HOLOGRAM_STYLE_DEFAULT,
  clampHologramSize,
  hologramCanvasFont,
  hologramStyleFlags,
  hologramTextFromLines,
  linesFromHologramText,
  parseHologramAppearanceLenient,
  parseHologramAppearanceStrict,
} from '../shared/hologramStyle';
import { parseClientMessage, parseNetworkHologram, parseServerMessage } from '../shared/protocol';
import { normalizeHologramRecord, toNetworkHologram } from '../server/services/holograms';

describe('hologram style serialization', () => {
  it('keeps font, size, and style on the network payload', () => {
    const record = normalizeHologramRecord({
      name: 'spawn',
      worldId: 'anarchy',
      x: 1,
      y: 2,
      z: 3,
      lines: ['Hello', 'World'],
      range: 32,
      enabled: true,
      font: 'ui',
      size: 1.4,
      style: 'italic',
    });
    expect(record).toMatchObject({
      name: 'spawn',
      font: 'ui',
      size: 1.4,
      style: 'italic',
      lines: ['Hello', 'World'],
    });
    expect(toNetworkHologram(record!)).toMatchObject({
      name: 'spawn',
      font: 'ui',
      size: 1.4,
      style: 'italic',
      lines: ['Hello', 'World'],
    });
  });

  it('loads old holograms without style using the historical canvas defaults', () => {
    const record = normalizeHologramRecord({
      name: 'legacy',
      worldId: 'anarchy',
      x: 0,
      y: 70,
      z: 0,
      lines: ['Old'],
      range: 48,
      enabled: true,
    });
    expect(record).toMatchObject({
      font: HOLOGRAM_FONT_DEFAULT,
      size: HOLOGRAM_SIZE_DEFAULT,
      style: HOLOGRAM_STYLE_DEFAULT,
      lines: ['Old'],
    });
    expect(HOLOGRAM_FONT_DEFAULT).toBe('sans');
    expect(HOLOGRAM_STYLE_DEFAULT).toBe('bold');
    const parsed = parseNetworkHologram({
      name: 'legacy',
      x: 0,
      y: 70,
      z: 0,
      lines: ['Old'],
      range: 48,
    });
    expect(parsed).toMatchObject({
      font: 'sans',
      size: 1,
      style: 'bold',
      lines: ['Old'],
    });
    expect(parseHologramAppearanceLenient({})).toEqual({
      ...DEFAULT_HOLOGRAM_APPEARANCE,
      lines: [''],
    });
  });

  it('validates font, size, and text length', () => {
    expect(parseHologramAppearanceStrict({
      lines: ['ok'],
      font: 'ui',
      size: 1,
      style: 'bold',
    }).ok).toBe(true);
    expect(parseHologramAppearanceStrict({
      lines: ['ok'],
      font: 'comic',
      size: 1,
      style: 'bold',
    })).toEqual({ ok: false, error: 'hologram font invalid' });
    expect(parseHologramAppearanceStrict({
      lines: ['ok'],
      font: 'ui',
      size: HOLOGRAM_SIZE_MAX + 1,
      style: 'bold',
    })).toEqual({ ok: false, error: 'hologram size invalid' });
    expect(parseHologramAppearanceStrict({
      lines: ['ok'],
      font: 'ui',
      size: HOLOGRAM_SIZE_MIN - 0.1,
      style: 'bold',
    })).toEqual({ ok: false, error: 'hologram size invalid' });
    expect(parseHologramAppearanceStrict({
      lines: ['x'.repeat(81)],
      font: 'ui',
      size: 1,
      style: 'bold',
    })).toEqual({ ok: false, error: 'hologram lines invalid' });
    expect(clampHologramSize(9)).toBe(HOLOGRAM_SIZE_MAX);
    expect(clampHologramSize(0.01)).toBe(HOLOGRAM_SIZE_MIN);
  });

  it('keeps multiline text through \\n and rejects unknown editor fonts', () => {
    expect(linesFromHologramText('A\nB\nC')).toEqual(['A', 'B', 'C']);
    expect(hologramTextFromLines(['A', 'B'])).toBe('A\nB');
    expect(parseClientMessage({
      type: 'hologram_update',
      name: 'spawn',
      lines: ['Hi'],
      font: 'papyrus',
      size: 1,
      style: 'bold',
    })).toEqual({ error: 'hologram font invalid' });
    expect(parseClientMessage({
      type: 'hologram_update',
      name: 'spawn',
      lines: ['Hi'],
      font: 'ui',
      size: 99,
      style: 'bold',
    })).toEqual({ error: 'hologram size invalid' });
    expect(parseClientMessage({
      type: 'hologram_update',
      x: 12,
      owner: 'hacker',
    })).toEqual({ error: 'hologram_update.name invalid' });
    const parsed = parseClientMessage({
      type: 'hologram_update',
      name: 'Spawn',
      lines: ['A', 'B'],
      font: 'display',
      size: 1.2,
      style: 'bold-italic',
      x: 99,
      owner: 'nope',
      id: 'hack',
    });
    expect(parsed).toEqual({
      type: 'hologram_update',
      name: 'spawn',
      lines: ['A', 'B'],
      font: 'display',
      size: 1.2,
      style: 'bold-italic',
    });
    expect('x' in parsed || 'owner' in parsed || 'id' in parsed).toBe(false);
  });

  it('parses hologram_editor snapshots with missing style as defaults', () => {
    const parsed = parseServerMessage({
      type: 'hologram_editor',
      hologram: { name: 'spawn', x: 1, y: 2, z: 3, lines: ['Hi'], range: 24 },
    });
    expect(parsed).toMatchObject({
      type: 'hologram_editor',
      hologram: { name: 'spawn', font: 'sans', size: 1, style: 'bold', lines: ['Hi'] },
    });
  });

  it('uses Inter / Press Start 2P / sans-serif canvas font strings', () => {
    expect(hologramCanvasFont('ui', 'bold')).toContain('700');
    expect(hologramCanvasFont('ui', 'bold')).toContain('Inter');
    expect(hologramCanvasFont('display', 'normal')).toContain('Press Start 2P');
    expect(hologramCanvasFont('sans', 'bold')).toBe('bold 36px sans-serif');
    expect(hologramStyleFlags('bold-italic')).toEqual({ bold: true, italic: true });
  });
});
