import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../shared/config';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(relative: string): string {
  return readFileSync(join(root, relative), 'utf8');
}

/**
 * Characterization of current `main` Anarchy movement.
 *
 * Networking V2 (PR #42, `e5c77f3`) is not an ancestor of this tree.
 * When V2 is integrated onto Farming `main`, replace this file with the
 * protocol-3 / FIFO / serverTick interpolation contract — do not "fix"
 * these expects by deleting V2.
 */
describe('Anarchy movement stack identity (current main)', () => {
  it('still speaks protocol 1 — V2 join gate never landed', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('does not contain the Networking V2 modules', () => {
    expect(existsSync(join(root, 'src/net/localPlayerPrediction.ts'))).toBe(false);
    expect(existsSync(join(root, 'src/net/remotePlayerInterpolation.ts'))).toBe(false);
    expect(existsSync(join(root, 'shared/playerCommand.ts'))).toBe(false);
    expect(existsSync(join(root, 'server/playerCommandQueue.ts'))).toBe(false);
    expect(existsSync(join(root, 'server/tickScheduler.ts'))).toBe(false);
  });

  it('server loop is naive setInterval, not tickCatchUp', () => {
    const source = read('server/WorldInstance.ts');
    expect(source).toMatch(/setInterval\(\(\) => this\.tick\(\), tickMs\)/);
    expect(source).not.toMatch(/tickCatchUp/);
    expect(source).toMatch(/player\.lastInput = input/);
  });

  it('online local motion chases the last snapshot instead of predicting', () => {
    const game = read('src/core/Game.ts');
    expect(game).toMatch(/stepTowardTarget\(session\.player\.position, online\.motion\.target/);
    expect(game).not.toMatch(/predictLocalMove\(/);
    expect(game).toMatch(/ingestAuthoritativePosition\(session\.player\.position, local\)/);
  });

  it('online clients skip the gameplay kernel, so they never tick farming', () => {
    expect(read('src/core/onlineSimulation.ts')).toMatch(
      /export function shouldRunClientWorldSimulation\(online: boolean\): boolean \{\s*return !online;/s,
    );
    const game = read('src/core/Game.ts');
    expect(game).toMatch(/if \(!shouldRunClientWorldSimulation\(Boolean\(session\.online\)\)\) \{\s*this\.tickOnline\(session\);\s*return;/s);
    expect(game).toMatch(/tickFarming: \(\) => \{\s*session\.farming\.tick\(\[/s);
  });

  it('remote interpolation timestamps samples with arrival time, not serverTick', () => {
    const view = read('src/net/RemotePlayerView.ts');
    expect(view).toMatch(/this\.samples\.push\(poseSample\(snapshot, now\)\)/);
    expect(view).toMatch(/MAX_SAMPLES = 8/);
    expect(view).not.toMatch(/serverTick/);
  });
});
