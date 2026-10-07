import { describe, expect, it } from 'vitest';
import { createHologramRecord, HologramNetwork } from '../server/services/holograms';
import { DUEL_COUNTDOWN_HOLOGRAM, DUEL_COUNTDOWN_HOLOGRAM_SIZE } from '../shared/duels';

function record(name: string, lines: string[]) {
  return createHologramRecord({
    name,
    worldId: 'anarchy',
    x: 1,
    y: 2,
    z: 3,
    lines,
    range: 32,
  });
}

describe('transient holograms', () => {
  it('lists transient holograms without persisting them', () => {
    const persisted: string[][] = [];
    const network = new HologramNetwork(() => undefined);
    network.setPersist((records) => {
      persisted.push(records.map((entry) => entry.name));
    });
    const permanent = record('Welcome', ['hello']);
    expect(network.upsert(permanent)?.name).toBe('welcome');
    const countdown = record(DUEL_COUNTDOWN_HOLOGRAM, ['3']);
    countdown.font = 'display';
    countdown.style = 'normal';
    countdown.size = DUEL_COUNTDOWN_HOLOGRAM_SIZE;
    countdown.backgroundEnabled = false;
    countdown.billboard = true;
    countdown.interactive = false;
    countdown.preserveTextAspect = true;
    expect(network.upsertTransient(countdown)?.name).toBe(DUEL_COUNTDOWN_HOLOGRAM);

    const listed = network.list();
    expect(listed.map((entry) => entry.name)).toEqual(['welcome', DUEL_COUNTDOWN_HOLOGRAM]);
    expect(listed[1]).toMatchObject({
      lines: ['3'],
      font: 'display',
      style: 'normal',
      size: 2.8,
      backgroundEnabled: false,
      billboard: true,
      interactive: false,
      preserveTextAspect: true,
    });
    expect(network.listRecords().some((entry) => entry.name === DUEL_COUNTDOWN_HOLOGRAM)).toBe(false);
    expect(network.listRecords().map((entry) => entry.name)).toEqual(['welcome']);
    expect(persisted).toEqual([['welcome']]);
    expect(persisted.flat()).not.toContain(DUEL_COUNTDOWN_HOLOGRAM);

    network.upsertTransient(record(DUEL_COUNTDOWN_HOLOGRAM, ['2']));
    expect(network.list().find((entry) => entry.name === DUEL_COUNTDOWN_HOLOGRAM)?.lines).toEqual(['2']);
    expect(persisted).toEqual([['welcome']]);

    network.replace([record('Shop', ['open'])]);
    expect(network.listRecords().map((entry) => entry.name)).toEqual(['shop']);
    expect(network.list().map((entry) => entry.name)).toEqual(['shop', DUEL_COUNTDOWN_HOLOGRAM]);
    expect(persisted).toEqual([['welcome']]);

    expect(network.removeTransient(DUEL_COUNTDOWN_HOLOGRAM)).toBe(true);
    expect(network.list().map((entry) => entry.name)).toEqual(['shop']);
    expect(network.listRecords().map((entry) => entry.name)).toEqual(['shop']);

    const restarted = new HologramNetwork(() => undefined);
    restarted.replace(network.listRecords());
    expect(restarted.list().map((entry) => entry.name)).toEqual(['shop']);
    expect(restarted.listRecords().map((entry) => entry.name)).toEqual(['shop']);
  });
});
