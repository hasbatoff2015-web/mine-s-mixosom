import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAX_WORLD_Y, MIN_WORLD_Y } from '../src/core/constants';
import {
  ClaimBoundaryRenderer,
  claimBoundaryEdgePositions,
} from '../src/rendering/ClaimBoundaryRenderer';
import { ClaimBoundaryNetwork } from '../server/services/claimBoundaries';
import { claimAnchorVolume } from '../server/services/claimAnchors';
import type { Claim } from '../server/services/claims';
import {
  CLAIM_BOUNDARY_DURATION_MS,
  decodeJson,
  encodeMessage,
  parseServerMessage,
  type ServerClaimBoundaryMessage,
} from '../shared/protocol';

function claim(volume: Claim['volume'], id = 'ada:1:1'): Claim {
  return {
    id,
    name: '1',
    owner: 'ada',
    worldId: 'anarchy',
    volume,
    members: [],
    priority: 0,
    flags: {},
    anchor: { x: 100, y: 64, z: 50, block: 'iron_block' },
  };
}

function roundTrip(message: unknown): ServerClaimBoundaryMessage {
  const parsed = parseServerMessage(decodeJson(encodeMessage(message as ServerClaimBoundaryMessage)));
  if ('error' in parsed) throw new Error(parsed.error);
  expect(parsed.type).toBe('claim_boundary');
  return parsed as ServerClaimBoundaryMessage;
}

describe('claim boundary runtime flow', () => {
  it('unicasts ClaimBoundaryNetwork through encode/parse onto ClaimBoundaryRenderer with cubic Y', () => {
    const sent: unknown[] = [];
    const network = new ClaimBoundaryNetwork((_playerId, message) => { sent.push(message); });
    const volume = claimAnchorVolume(100, 64, 50, 'iron_block');
    network.show('player-1', claim(volume));
    expect(sent).toHaveLength(1);

    const parsed = roundTrip(sent[0]);
    expect(parsed).toMatchObject({
      type: 'claim_boundary',
      claimId: 'ada:1:1',
      name: '1',
      worldId: 'anarchy',
      minX: 90,
      maxX: 110,
      minY: 54,
      maxY: 74,
      minZ: 40,
      maxZ: 60,
      durationMs: CLAIM_BOUNDARY_DURATION_MS,
    });

    const edges = claimBoundaryEdgePositions(
      parsed.minX, parsed.minY, parsed.minZ, parsed.maxX, parsed.maxY, parsed.maxZ,
    );
    expect(edges[1]).toBe(54);
    expect(edges[25]).toBe(75);
    expect(edges[1]).not.toBe(MIN_WORLD_Y);
    expect(edges[25]).not.toBe(MAX_WORLD_Y + 1);

    const scene = new THREE.Scene();
    const renderer = new ClaimBoundaryRenderer(scene);
    renderer.show(parsed, 1_000);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]!.name).toBe('claim-boundary:ada:1:1');
    renderer.update(1_000 + CLAIM_BOUNDARY_DURATION_MS - 1);
    expect(scene.children).toHaveLength(1);
    renderer.update(1_000 + CLAIM_BOUNDARY_DURATION_MS + 1);
    expect(scene.children).toHaveLength(0);
    renderer.dispose();
  });

  it('keeps a small ordinary claim box on the same renderer path', () => {
    const sent: unknown[] = [];
    const network = new ClaimBoundaryNetwork((_playerId, message) => { sent.push(message); });
    network.show('player-1', claim({
      minX: 0, minY: 70, minZ: 0, maxX: 8, maxY: 74, maxZ: 8,
    }, 'ada:spawn:1'));
    const parsed = roundTrip(sent[0]);
    const scene = new THREE.Scene();
    const renderer = new ClaimBoundaryRenderer(scene);
    renderer.show(parsed, 500);
    expect(scene.children[0]!.name).toBe('claim-boundary:ada:spawn:1');
    const edges = claimBoundaryEdgePositions(
      parsed.minX, parsed.minY, parsed.minZ, parsed.maxX, parsed.maxY, parsed.maxZ,
    );
    expect(edges[1]).toBe(70);
    expect(edges[25]).toBe(75);
    renderer.dispose();
  });
});
