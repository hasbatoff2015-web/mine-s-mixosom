import type { LegacyModelBox, LegacyModelDefinition, LegacyModelPart, LegacyVector } from './LegacyModel';

/**
 * Mutant Zombie, ported from Mutant Beasts by Chumbanotz (AGPL-3.0).
 * Model: https://github.com/Chumbanotz/MutantBeasts/blob/master/src/main/java/chumbanotz/mutantbeasts/client/renderer/entity/model/MutantZombieModel.java
 * Texture: src/main/resources/assets/mutantbeasts/textures/entity/mutant_zombie.png
 *
 * Box sizes, pivots, child links, inflate and UV offsets follow that model.
 * The whole rig is scaled by MEGA_ZOMBIE_MODEL_SCALE (the original 1.3
 * preRenderCallback), not by resizing individual parts.
 * The villager head is constructed in the Java model and then hidden in
 * render(); it is omitted here so the visible silhouette stays the mutant.
 */

const box = (
  origin: LegacyVector,
  size: LegacyVector,
  textureOffset: readonly [number, number],
  options: Omit<LegacyModelBox, 'origin' | 'size' | 'textureOffset'> = {},
): LegacyModelBox => ({ origin, size, textureOffset, ...options });

const part = (
  name: string,
  rotationPoint: LegacyVector,
  boxes: readonly LegacyModelBox[],
  parent?: string,
): LegacyModelPart => ({
  name,
  rotationPoint,
  boxes,
  ...(parent ? { parent } : {}),
});

export const MUTANT_ZOMBIE_MODEL: LegacyModelDefinition = {
  texturePath: 'entity/mutant_zombie',
  logicalTextureSize: [128, 128],
  parts: [
    part('pelvis', [0, 10, 6], []),
    part('waist', [0, 0, 0], [
      box([-7, -16, -6], [14, 16, 12], [0, 44]),
    ], 'pelvis'),
    part('chest', [0, -12, 0], [
      box([-12, -12, -8], [24, 12, 16], [0, 16]),
    ], 'waist'),
    part('head', [0, -11, -4], [
      box([-4, -8, -4], [8, 8, 8], [0, 0]),
    ], 'chest'),
    part('arm1', [-11, -8, 2], [
      box([-3, 0, -3], [6, 16, 6], [104, 0]),
    ], 'chest'),
    part('arm2', [11, -8, 2], [
      box([-3, 0, -3], [6, 16, 6], [104, 0], { mirror: true }),
    ], 'chest'),
    part('forearm1', [0, 14, 0], [
      box([-3, 0, -3], [6, 16, 6], [104, 22], { inflate: 0.1 }),
    ], 'arm1'),
    part('forearm2', [0, 14, 0], [
      box([-3, 0, -3], [6, 16, 6], [104, 22], { mirror: true, inflate: 0.1 }),
    ], 'arm2'),
    part('leg1', [-5, -2, 0], [
      box([-3, 0, -3], [6, 11, 6], [80, 0]),
    ], 'pelvis'),
    part('leg2', [5, -2, 0], [
      box([-3, 0, -3], [6, 11, 6], [80, 0], { mirror: true }),
    ], 'pelvis'),
    part('foreleg1', [0, 9.5, 0], [
      box([-3, 0, -3], [6, 8, 6], [80, 17], { inflate: 0.1 }),
    ], 'leg1'),
    part('foreleg2', [0, 9.5, 0], [
      box([-3, 0, -3], [6, 8, 6], [80, 17], { mirror: true, inflate: 0.1 }),
    ], 'leg2'),
  ],
};
