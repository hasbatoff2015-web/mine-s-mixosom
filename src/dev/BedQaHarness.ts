import * as THREE from 'three';
import { BlockId, horizontalFacingNormal, type HorizontalFacing } from '../blocks';
import { ChunkMesher } from '../rendering/ChunkMesher';
import { ItemVisualFactory } from '../rendering/ItemVisualFactory';
import { TextureAtlas } from '../rendering/TextureAtlas';
import { MinecraftSkinRegistry } from '../rendering/player/MinecraftSkin';
import { PlayerSkinGeometryCache } from '../rendering/player/PlayerSkinGeometry';
import { PlayerVisual } from '../rendering/player/PlayerVisual';
import { DEFAULT_PLAYER_APPEARANCE } from '../player/appearance/PlayerAppearance';
import { bedRestPosition, resolveBedRest } from '../world/bed';
import { VoxelWorld } from '../world/World';

/** Dev-only view of the exact atlas and mesher used for placed beds. */
export async function startBedQaHarness(canvas: HTMLCanvasElement, uiRoot: HTMLElement): Promise<() => void> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const atlas = await TextureAtlas.create(Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
  const params = new URLSearchParams(location.search);
  const requestedFacing = params.get('facing');
  const facing: HorizontalFacing = requestedFacing === 'east' || requestedFacing === 'south' || requestedFacing === 'west'
    ? requestedFacing : 'north';
  const [dx, , dz] = horizontalFacingNormal(facing);
  const footX = 7;
  const footZ = 7;
  const headX = footX + dx;
  const headZ = footZ + dz;
  const world = new VoxelWorld('bed-qa');
  const chunk = world.getChunk(0, 0)!;
  chunk.blocks.fill(BlockId.Air);
  chunk.set(footX, 40, footZ, BlockId.WhiteBed);
  chunk.set(headX, 40, headZ, BlockId.WhiteBed);
  world.setBlockState(footX, 40, footZ, { facing, bedPart: 'foot' });
  world.setBlockState(headX, 40, headZ, { facing, bedPart: 'head' });
  const meshed = new ChunkMesher(atlas, (x, y, z) => world.getBlockState(x, y, z)).build(chunk, world);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x30343a);
  const bedMaterial = new THREE.MeshBasicMaterial({ map: atlas.texture, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(meshed.opaque, bedMaterial));
  let player: PlayerVisual | undefined;
  let skins: MinecraftSkinRegistry | undefined;
  let geometries: PlayerSkinGeometryCache | undefined;
  let items: ItemVisualFactory | undefined;
  if (params.get('pose') === '1') {
    skins = new MinecraftSkinRegistry();
    geometries = new PlayerSkinGeometryCache();
    items = new ItemVisualFactory({ atlas });
    const model = params.get('model') === 'slim' ? 'slim' : 'classic';
    player = new PlayerVisual(skins, geometries, items, { ...DEFAULT_PLAYER_APPEARANCE, model });
    if (params.get('armor') === '1') player.setArmor({ head: 'iron_helmet', chest: 'iron_chestplate', legs: 'iron_leggings', feet: 'iron_boots' });
    if (params.get('held') === '1') player.setHeldItem('apple');
    if (params.get('offhand') === '1') player.setOffhandItem('totem_of_undying');
    const rest = resolveBedRest(world, headX, 40, headZ)!;
    player.root.position.fromArray(bedRestPosition(rest));
    player.update(1 / 60, { bedRest: rest, viewYaw: 0, viewPitch: 0, movementSpeed: 0,
      onGround: true, sneaking: false, sprinting: false, verticalVelocity: 0,
      mining: false, bowCharge: 0, swordBlocking: false, foodUseProgress: 0,
      invisible: false, hurtFlash: 0 });
    scene.add(player.root);
  }
  const centerX = (footX + headX) / 2 + 0.5;
  const centerZ = (footZ + headZ) / 2 + 0.5;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ color: 0x7d7d7d }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(centerX, 39.995, centerZ);
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 30);
  camera.position.set(centerX + 2.8, 42.4, centerZ + 3.8);
  camera.lookAt(centerX, 40.5, centerZ);
  uiRoot.innerHTML = `<div style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111d;color:#fff;font:14px monospace;z-index:5">Bed QA · ${facing}${player ? ' · face-up pose' : ''} · real entity sheet + ChunkMesher</div>`;
  const resize = () => {
    renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight), false);
    camera.aspect = Math.max(1, innerWidth) / Math.max(1, innerHeight);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  resize();
  // Skin textures load asynchronously; keep the optional player pose refreshed.
  let frame = 0;
  if (player) {
    const renderPose = () => { renderer.render(scene, camera); frame = requestAnimationFrame(renderPose); };
    frame = requestAnimationFrame(renderPose);
  }
  addEventListener('resize', resize);
  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', resize);
    meshed.opaque.dispose();
    meshed.cutout.dispose();
    meshed.vegetation.dispose();
    meshed.translucent.dispose();
    meshed.water.dispose();
    meshed.fire.dispose();
    bedMaterial.dispose();
    player?.dispose();
    geometries?.dispose();
    skins?.dispose();
    items?.dispose();
    floor.geometry.dispose();
    (floor.material as THREE.Material).dispose();
    atlas.dispose();
    renderer.dispose();
  };
}
