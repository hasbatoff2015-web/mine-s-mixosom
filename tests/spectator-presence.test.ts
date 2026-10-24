import { describe, expect, it } from 'vitest';
import { remotePlayerPresence } from '../src/net/spectatorPresence';

describe('spectator remote presence', () => {
  it('hides the body and the invisibility swirls, then restores a normal player', () => {
    const watching = remotePlayerPresence({ gamemode: 'spectator', invisible: false });
    expect(watching.hideModel).toBe(true);
    expect(watching.hideNameplate).toBe(true);
    expect(watching.invisibilityParticles).toBe(false);

    const potion = remotePlayerPresence({ gamemode: 'survival', invisible: true });
    expect(potion.hideModel).toBe(true);
    expect(potion.invisibilityParticles).toBe(true);

    const restored = remotePlayerPresence({ gamemode: 'survival', invisible: false });
    expect(restored.hideModel).toBe(false);
    expect(restored.hideNameplate).toBe(false);
    expect(restored.invisibilityParticles).toBe(false);
  });
});