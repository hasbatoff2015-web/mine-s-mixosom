import * as THREE from 'three';
import { BlockId } from '../blocks';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../core/constants';
import { TextureAtlas } from '../rendering/TextureAtlas';
import { WorldRenderer } from '../rendering/WorldRenderer';
import { disposeWorldLighting } from '../world/LightEngine';
import { VoxelWorld } from '../world/World';

export type WorldgenDepositQaMaterial = 'gravel' | 'clay';

interface DepositView {
  readonly target: THREE.Vector3;
  readonly camera: THREE.Vector3;
}

const VIEW_DIRECTIONS = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0],
] as const;

export async function startWorldgenDepositQaHarness(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  material: WorldgenDepositQaMaterial,
): Promise<() => void> {
  const block = material === 'gravel' ? BlockId.Gravel : BlockId.Clay;
  const world = new VoxelWorld('alpha');
  const view = findDepositView(world, block);
  if (!view) throw new Error(`Worldgen QA could not find a visible ${material} deposit.`);

  world.ensureChunks(view.target.x, view.target.z, 2, 25);
  const lightX = Math.floor(view.camera.x);
  const lightY = Math.floor(view.camera.y);
  const lightZ = Math.floor(view.camera.z);
  const verticalView = Math.abs(view.target.y - view.camera.y) > 1;
  world.setBlock(lightX + (verticalView ? 1 : 0), lightY + (verticalView ? 0 : 1), lightZ, BlockId.Torch, false);
  world.setViewCenter(view.target.x, view.target.z, 2);
  world.deferredLighting = true;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const atlas = await TextureAtlas.create(Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
  const worldRenderer = new WorldRenderer(world, atlas);
  worldRenderer.setDaylight(0.12);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080b0e);
  scene.add(worldRenderer.group);
  scene.add(new THREE.HemisphereLight(0xa8c7df, 0x17120d, 0.34));
  const inspectionLight = new THREE.PointLight(0xffd7a1, 2.8, 18);
  inspectionLight.position.copy(view.camera);
  scene.add(inspectionLight);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 80);
  camera.position.copy(view.camera);
  camera.lookAt(view.target);
  uiRoot.innerHTML = `<div style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111d;color:#fff;font:14px monospace;z-index:5">worldgen v2 QA · natural ${material} deposit · seed alpha<br>x ${Math.floor(view.target.x)} · y ${Math.floor(view.target.y)} · z ${Math.floor(view.target.z)}</div>`;

  const resize = (): void => {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);

  let frame = 0;
  const render = (): void => {
    world.processLighting(3, view.target.x, view.target.z);
    worldRenderer.rebuildDirty(3, 6, view.target.x, view.target.z, { requireNeighborLight: true });
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  render();

  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', resize);
    worldRenderer.dispose();
    disposeWorldLighting(world);
    atlas.dispose();
    renderer.dispose();
  };
}

function findDepositView(world: VoxelWorld, material: BlockId.Gravel | BlockId.Clay): DepositView | undefined {
  for (let radius = 0; radius <= 8; radius += 1) {
    for (let chunkZ = -radius; chunkZ <= radius; chunkZ += 1) {
      for (let chunkX = -radius; chunkX <= radius; chunkX += 1) {
        if (Math.max(Math.abs(chunkX), Math.abs(chunkZ)) !== radius) continue;
        const chunk = world.getChunk(chunkX, chunkZ)!;
        for (let y = 14; y <= 54 && y < WORLD_HEIGHT; y += 1) {
          for (let localZ = 1; localZ < CHUNK_SIZE - 1; localZ += 1) {
            for (let localX = 1; localX < CHUNK_SIZE - 1; localX += 1) {
              if (chunk.get(localX, y, localZ) !== material) continue;
              const x = chunkX * CHUNK_SIZE + localX;
              const z = chunkZ * CHUNK_SIZE + localZ;
              for (const [dx, dy, dz] of VIEW_DIRECTIONS) {
                if (world.getBlock(x + dx, y + dy, z + dz, false) !== BlockId.Air) continue;
                return {
                  target: new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5),
                  camera: new THREE.Vector3(x + dx * 1.45 + 0.5, y + dy * 1.45 + 0.5, z + dz * 1.45 + 0.5),
                };
              }
            }
          }
        }
      }
    }
  }
  return undefined;
}
