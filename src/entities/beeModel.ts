/**
 * Original voxel bee. Proportions are in the same family as a small flying
 * insect (body about 7×7×10 model units, wings wider than the body) but the
 * pivots, UVs, and texture are authored for this game's LegacyModel.
 * Mojang bedrock samples were used only as a visual reference and are not
 * copied into the build.
 *
 * 16 model units = 1 block. Child pivots are parent-relative, Y-down.
 * The body centre sits near world Y=0.5 so the legs hang above the entity origin.
 */
const box = (
  origin: readonly [number, number, number],
  size: readonly [number, number, number],
  textureOffset: readonly [number, number],
  options: {
    readonly mirror?: boolean;
    readonly doubleSided?: boolean;
    readonly alphaTest?: number;
    readonly physicalSize?: readonly [number, number, number];
  } = {},
) => ({ origin, size, textureOffset, ...options });

export const BEE_MODEL = {
  texturePath: 'entity/bee',
  logicalTextureSize: [64, 64] as const,
  parts: [
    {
      name: 'body',
      rotationPoint: [0, 16, 0],
      boxes: [
        box([-3.5, -3.5, -5], [7, 7, 10], [0, 0]),
      ],
    },
    {
      name: 'stinger',
      parent: 'body',
      rotationPoint: [0, 0.2, 5],
      boxes: [
        box([-1, -1, 0], [2, 2, 3], [0, 20]),
        box([-0.5, -0.5, 3], [1, 1, 2], [0, 20]),
      ],
    },
    {
      name: 'antennaRight',
      parent: 'body',
      rotationPoint: [1.4, -3.3, -4.6],
      rotation: [0.45, 0, -0.35],
      boxes: [box([-0.5, -5, -0.5], [1, 5, 1], [16, 20])],
    },
    {
      name: 'antennaLeft',
      parent: 'body',
      rotationPoint: [-1.4, -3.3, -4.6],
      rotation: [0.45, 0, 0.35],
      boxes: [box([-0.5, -5, -0.5], [1, 5, 1], [16, 20], { mirror: true })],
    },
    {
      name: 'rightWing',
      parent: 'body',
      rotationPoint: [1.6, -3.3, -0.4],
      boxes: [box([0, -0.2, -3], [10, 0.4, 6], [0, 32], {
        doubleSided: true,
        alphaTest: 0.15,
        physicalSize: [10, 0.55, 6],
      })],
    },
    {
      name: 'leftWing',
      parent: 'body',
      rotationPoint: [-1.6, -3.3, -0.4],
      boxes: [box([-10, -0.2, -3], [10, 0.4, 6], [0, 32], {
        mirror: true,
        doubleSided: true,
        alphaTest: 0.15,
        physicalSize: [10, 0.55, 6],
      })],
    },
    {
      name: 'leg1',
      parent: 'body',
      rotationPoint: [-1.7, 3.15, -2.2],
      boxes: [box([-0.5, 0, -0.5], [1, 3, 1], [24, 20])],
    },
    {
      name: 'leg2',
      parent: 'body',
      rotationPoint: [1.7, 3.15, -2.2],
      boxes: [box([-0.5, 0, -0.5], [1, 3, 1], [24, 20], { mirror: true })],
    },
    {
      name: 'leg3',
      parent: 'body',
      rotationPoint: [-1.8, 3.2, 0.2],
      boxes: [box([-0.5, 0, -0.5], [1, 3, 1], [24, 20])],
    },
    {
      name: 'leg4',
      parent: 'body',
      rotationPoint: [1.8, 3.2, 0.2],
      boxes: [box([-0.5, 0, -0.5], [1, 3, 1], [24, 20], { mirror: true })],
    },
    {
      name: 'leg5',
      parent: 'body',
      rotationPoint: [-1.6, 3.15, 2.4],
      boxes: [box([-0.5, 0, -0.5], [1, 3, 1], [24, 20])],
    },
    {
      name: 'leg6',
      parent: 'body',
      rotationPoint: [1.6, 3.15, 2.4],
      boxes: [box([-0.5, 0, -0.5], [1, 3, 1], [24, 20], { mirror: true })],
    },
  ],
};
