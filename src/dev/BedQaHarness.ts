import * as THREE from 'three';
import { BlockId } from '../blocks';
import { ChunkMesher } from '../rendering/ChunkMesher';
import { TextureAtlas } from '../rendering/TextureAtlas';
import { VoxelWorld } from '../world/World';

/** Dev-only view of the exact atlas and mesher used for placed beds. */
export async function startBedQaHarness(canvas: HTMLCanvasElement, uiRoot: HTMLElement): Promise<() => void> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const atlas = await TextureAtlas.create(Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
  const world = new VoxelWorld('bed-qa');
  const chunk = world.getChunk(0, 0)!;
  chunk.blocks.fill(BlockId.Air);
  chunk.set(7, 40, 7, BlockId.WhiteBed);
  chunk.set(7, 40, 6, BlockId.WhiteBed);
  world.setBlockState(7, 40, 7, { facing: 'north', bedPart: 'foot' });
  world.setBlockState(7, 40, 6, { facing: 'north', bedPart: 'head' });
  const meshed = new ChunkMesher(atlas, (x, y, z) => world.getBlockState(x, y, z)).build(chunk, world);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x30343a);
  const bedMaterial = new THREE.MeshBasicMaterial({ map: atlas.texture, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(meshed.opaque, bedMaterial));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ color: 0x7d7d7d }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(7.5, 39.995, 7);
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 30);
  camera.position.set(10.3, 42.4, 10.8);
  camera.lookAt(7.5, 40.25, 7);
  uiRoot.innerHTML = '<div style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111d;color:#fff;font:14px monospace;z-index:5">Bed QA · real entity sheet + ChunkMesher</div>';
  const resize = () => {
    renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight), false);
    camera.aspect = Math.max(1, innerWidth) / Math.max(1, innerHeight);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  resize();
  addEventListener('resize', resize);
  return () => {
    removeEventListener('resize', resize);
    meshed.opaque.dispose();
    meshed.cutout.dispose();
    meshed.vegetation.dispose();
    meshed.translucent.dispose();
    meshed.water.dispose();
    meshed.fire.dispose();
    bedMaterial.dispose();
    floor.geometry.dispose();
    (floor.material as THREE.Material).dispose();
    atlas.dispose();
    renderer.dispose();
  };
}
