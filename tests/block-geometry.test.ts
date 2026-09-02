import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId, type BlockAttachment, type BlockRenderState, type HorizontalFacing } from '../src/blocks';
import {
  buttonSelectionBox,
  leverSelectionBoxes,
  slabLocalBoxes as renderSlabLocalBoxes,
  stairLocalBoxes as renderStairLocalBoxes,
} from '../src/rendering/specialBlockGeometry';
import {
  buttonLocalBoxes,
  chainSelectionLocalBox,
  controlLocalBoxes,
  lanternSelectionLocalBox,
  leverLocalBoxes,
  railLocalBoxes,
  slabLocalBoxes,
  stairLocalBoxes,
  type LocalBox,
} from '../src/world/blockGeometry';

const ROOT = process.cwd();
const FACINGS: readonly HorizontalFacing[] = ['north', 'south', 'east', 'west'];
const ATTACHMENTS: readonly BlockAttachment[] = ['floor', 'wall', 'ceiling'];

function source(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

function importSpecifiers(text: string): string[] {
  const matches = text.matchAll(/from ['"]([^'"]+)['"]/g);
  return [...matches].map((match) => match[1]!);
}

function envelopeFromMatrix(matrix: THREE.Matrix4): LocalBox {
  const bounds = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5))
    .applyMatrix4(matrix);
  return {
    minX: bounds.min.x,
    minY: bounds.min.y,
    minZ: bounds.min.z,
    maxX: bounds.max.x,
    maxY: bounds.max.y,
    maxZ: bounds.max.z,
  };
}

function expectBoxClose(actual: LocalBox, expected: LocalBox, digits = 10): void {
  expect(actual.minX).toBeCloseTo(expected.minX, digits);
  expect(actual.minY).toBeCloseTo(expected.minY, digits);
  expect(actual.minZ).toBeCloseTo(expected.minZ, digits);
  expect(actual.maxX).toBeCloseTo(expected.maxX, digits);
  expect(actual.maxY).toBeCloseTo(expected.maxY, digits);
  expect(actual.maxZ).toBeCloseTo(expected.maxZ, digits);
}

describe('simulation block geometry import boundary', () => {
  it('does not import Three.js or rendering from the geometry module', () => {
    const text = source('src/world/blockGeometry.ts');
    expect(text).not.toMatch(/from ['"]three['"]/);
    expect(text).not.toMatch(/from ['"][^'"]*rendering\//);
    expect(importSpecifiers(text).every((specifier) => specifier.startsWith('../blocks'))).toBe(true);
  });

  it('keeps collision / selection / placement / use / rails / ladders off specialBlockGeometry', () => {
    const files = [
      'server/gameplay.ts',
      'src/world/collision.ts',
      'src/world/selection.ts',
      'src/world/placement.ts',
      'src/gameplay/useInteraction.ts',
      'src/player/ladderMotion.ts',
      'src/entities/railPath.ts',
      'src/core/Game.ts',
    ];
    for (const file of files) {
      expect(source(file), file).not.toMatch(/specialBlockGeometry/);
      expect(source(file), file).not.toMatch(/from ['"][^'"]*rendering\/specialBlockGeometry['"]/);
    }
  });
});

describe('shared geometry identity', () => {
  it('re-exports the same slab/stair functions rendering meshers call', () => {
    expect(renderSlabLocalBoxes).toBe(slabLocalBoxes);
    expect(renderStairLocalBoxes).toBe(stairLocalBoxes);
  });

  it('keeps slab / stair / lantern / rail local boxes on the previous numbers', () => {
    expect(slabLocalBoxes('bottom')).toEqual([
      { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.5, maxZ: 1 },
    ]);
    expect(slabLocalBoxes('top')).toEqual([
      { minX: 0, minY: 0.5, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
    ]);
    expect(slabLocalBoxes('double')).toEqual([
      { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
    ]);
    expect(stairLocalBoxes('east', 'bottom', 'straight')).toEqual([
      { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.5, maxZ: 1 },
      { minX: 0.5, minY: 0.5, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
    ]);
    expect(lanternSelectionLocalBox({ attachment: 'floor' })).toEqual({
      minX: 5 / 16, minY: 0, minZ: 5 / 16, maxX: 11 / 16, maxY: 9 / 16, maxZ: 11 / 16,
    });
    expect(lanternSelectionLocalBox({ attachment: 'ceiling' })).toEqual({
      minX: 5 / 16, minY: 1 / 16, minZ: 5 / 16, maxX: 11 / 16, maxY: 10 / 16, maxZ: 11 / 16,
    });
    expect(chainSelectionLocalBox()).toEqual({
      minX: 6.5 / 16, minY: 0, minZ: 6.5 / 16, maxX: 9.5 / 16, maxY: 1, maxZ: 9.5 / 16,
    });
    expect(railLocalBoxes('north_south')[0]?.maxY).toBe(2 / 16);
    expect(railLocalBoxes('ascending_east')).toHaveLength(2);
  });

  it('button/lever simulation AABBs match Three.js envelopes of the mesh cuboids', () => {
    for (const attachment of ATTACHMENTS) {
      for (const facing of FACINGS) {
        for (const powered of [false, true]) {
          const state: BlockRenderState = { attachment, facing, powered };
          const buttonSim = buttonLocalBoxes(state);
          const buttonMesh = envelopeFromMatrix(buttonSelectionBox(0, 0, 0, state).matrix);
          expect(buttonSim).toHaveLength(1);
          expectBoxClose(buttonSim[0]!, buttonMesh);
          expectBoxClose(controlLocalBoxes(BlockId.StoneButton, state)[0]!, buttonMesh);

          const leverSim = leverLocalBoxes(state);
          const leverMesh = leverSelectionBoxes(0, 0, 0, state).map((part) => envelopeFromMatrix(part.matrix));
          expect(leverSim).toHaveLength(2);
          expectBoxClose(leverSim[0]!, leverMesh[0]!);
          expectBoxClose(leverSim[1]!, leverMesh[1]!);
        }
      }
    }
  });
});
