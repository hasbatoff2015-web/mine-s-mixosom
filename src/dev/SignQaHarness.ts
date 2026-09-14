import * as THREE from 'three';
import { BlockId, type HorizontalFacing } from '../blocks';
import { ChunkMesher } from '../rendering/ChunkMesher';
import { SignRenderer } from '../rendering/SignRenderer';
import { TextureAtlas } from '../rendering/TextureAtlas';
import { VoxelWorld } from '../world/World';

/** Dev-only standing/wall sign scene using the production atlas, mesher and text. */
export async function startSignQaHarness(canvas: HTMLCanvasElement, uiRoot: HTMLElement): Promise<() => void> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const atlas = await TextureAtlas.create();
  const world = new VoxelWorld('sign-qa');
  const chunk = world.getChunk(0, 0)!;
  chunk.blocks.fill(BlockId.Air);
  chunk.set(5, 40, 6, BlockId.OakSign);
  chunk.set(9, 40, 6, BlockId.OakSign);
  world.setSignText(5, 40, 6, ['STANDING', 'front', '', '']);
  world.setSignText(9, 40, 6, ['WALL', 'front', '', '']);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x30343a);
  const material = new THREE.MeshBasicMaterial({ map: atlas.texture, side: THREE.DoubleSide, transparent: true, alphaTest: 0.5 });
  const signs = new SignRenderer(world, () => true);
  scene.add(signs.group);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 5), new THREE.MeshBasicMaterial({ color: 0x777d80 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(7.5, 39.995, 6);
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 40);
  camera.position.set(7.5, 42.1, 12);
  camera.lookAt(7.5, 40.55, 6);

  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;left:16px;top:16px;padding:8px 12px;background:#111d;color:#fff;font:14px monospace;z-index:5';
  panel.innerHTML = 'Sign QA · entity sheet + text<br>Standing rotation <select id="qa-standing"></select> Wall facing <select id="qa-wall"></select>';
  uiRoot.replaceChildren(panel);
  const standing = panel.querySelector<HTMLSelectElement>('#qa-standing')!;
  for (let rotation = 0; rotation < 16; rotation += 1) {
    const option = document.createElement('option');
    option.value = String(rotation);
    option.textContent = String(rotation);
    standing.append(option);
  }
  const wall = panel.querySelector<HTMLSelectElement>('#qa-wall')!;
  for (const facing of ['south', 'west', 'north', 'east'] as const) {
    const option = document.createElement('option');
    option.value = facing;
    option.textContent = facing;
    wall.append(option);
  }
  let mesh: THREE.Mesh | undefined;
  let meshed: ReturnType<ChunkMesher['build']> | undefined;
  const rebuild = () => {
    mesh?.removeFromParent();
    for (const geometry of meshed ? Object.values(meshed) : []) {
      if (geometry instanceof THREE.BufferGeometry) geometry.dispose();
    }
    world.setBlockState(5, 40, 6, { attachment: 'floor', signRotation: Number(standing.value), facing: 'south' });
    world.setBlockState(9, 40, 6, { attachment: 'wall', facing: wall.value as HorizontalFacing });
    meshed = new ChunkMesher(atlas, (x, y, z) => world.getBlockState(x, y, z)).build(chunk, world);
    mesh = new THREE.Mesh(meshed.cutout, material);
    scene.add(mesh);
    signs.invalidateVisibility();
    signs.sync();
    render();
  };
  const render = () => {
    renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight), false);
    camera.aspect = Math.max(1, innerWidth) / Math.max(1, innerHeight);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  standing.onchange = rebuild;
  wall.onchange = rebuild;
  rebuild();
  addEventListener('resize', render);
  return () => {
    removeEventListener('resize', render);
    standing.onchange = wall.onchange = null;
    mesh?.removeFromParent();
    for (const geometry of meshed ? Object.values(meshed) : []) {
      if (geometry instanceof THREE.BufferGeometry) geometry.dispose();
    }
    signs.dispose();
    material.dispose();
    floor.geometry.dispose();
    (floor.material as THREE.Material).dispose();
    atlas.dispose();
    renderer.dispose();
  };
}
