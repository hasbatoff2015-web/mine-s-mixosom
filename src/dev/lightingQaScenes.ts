import { BlockId } from '../blocks';
import { CHUNK_SIZE, WORLD_HEIGHT, chunkKey } from '../core/constants';
import { Chunk } from '../world/Chunk';
import { VoxelWorld, type BlockMutation } from '../world/World';

export type LightingQaScene = 'room' | 'closed' | 'hole' | 'cave' | 'forest' | 'sources';

/** Shared deterministic geometry for CPU regressions, benchmarks and the existing DEV viewer. */
export function createLightingQaScene(kind: LightingQaScene, WorldType = VoxelWorld, ChunkType = Chunk): VoxelWorld {
  const world = new WorldType(`lighting-qa-${kind}`);
  for (let cz = -1; cz <= 2; cz += 1) {
    for (let cx = -1; cx <= 2; cx += 1) {
      const chunk = new ChunkType(cx, cz);
      chunk.generated = true;
      chunk.blocks.fill(BlockId.Stone, 0, 40 * CHUNK_SIZE * CHUNK_SIZE);
      chunk.surfaceHeights.fill(39);
      world.chunks.set(chunkKey(cx, cz), chunk);
    }
  }
  const put = (x: number, y: number, z: number, block: BlockId): void => {
    world.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE), false)!
      .set(((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE, y, ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE, block);
  };
  if (kind === 'forest') {
    for (let z = 4; z <= 27; z += 1) for (let x = 4; x <= 27; x += 1) {
      for (let y = 46; y <= 54; y += 1) put(x, y, z, y % 3 === 0 ? BlockId.BirchLeaves : BlockId.OakLeaves);
    }
    for (let y = 40; y <= 55; y += 1) put(17, y, 17, BlockId.OakLog);
  } else {
    const material = kind === 'cave' ? BlockId.Stone : BlockId.OakPlanks;
    for (let z = 3; z <= 28; z += 1) for (let x = 2; x <= 29; x += 1) {
      put(x, 47, z, material);
      if (x === 2 || x === 29 || z === 3 || z === 28) {
        for (let y = 40; y <= 46; y += 1) put(x, y, z, material);
      }
    }
    if (kind === 'room' || kind === 'cave' || kind === 'sources') {
      for (const cell of lightingQaOpening(true)) put(cell.x, cell.y, cell.z, cell.block);
    }
    if (kind === 'hole') put(7, 47, 16, BlockId.Air);
    put(6, 40, 10, BlockId.Stone);
    put(6, 40, 12, BlockId.StoneSlab);
    put(6, 40, 14, BlockId.StoneStairs);
    put(6, 40, 18, BlockId.OakFence);
    if (kind === 'sources') {
      put(13, 40, 10, BlockId.Torch);
      put(13, 40, 16, BlockId.Glowstone);
      put(13, 40, 22, BlockId.Lantern);
      put(13, 41, 22, BlockId.Chain);
    }
  }
  world.setViewCenter(8, 8, 1);
  return world;
}

export function lightingQaOpening(open: boolean): BlockMutation[] {
  const cells: BlockMutation[] = [];
  for (let z = 4; z <= 27; z += 1) for (let y = 40; y <= 46; y += 1) {
    cells.push({ x: 2, y, z, block: open ? BlockId.Air : BlockId.OakPlanks });
  }
  return cells;
}

export function lightingQaRoofHole(open: boolean): BlockMutation[] {
  return [{ x: 7, y: 47, z: 16, block: open ? BlockId.Air : BlockId.OakPlanks }];
}

export function lightingQaSkyLine(world: VoxelWorld): number[] {
  return Array.from({ length: 26 }, (_, i) => world.skyLightAt(3 + i, Math.min(43, WORLD_HEIGHT - 1), 16));
}
