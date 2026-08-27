import * as THREE from 'three';
import { TextureAtlas } from './TextureAtlas';
import { bindEntityLightReceiver, createEntityMaterial } from './worldLighting';

/** Both projectile managers orient this local axis along velocity. */
export const ARROW_FORWARD = new THREE.Vector3(0, 0, 1);

/** Shared thin shaft, pointed head and tail-only feathers. Origin is near the tip. */
export class ArrowVisualFactory {
  private readonly geometry = createArrowGeometry();
  private readonly texture: THREE.Texture;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly flamingMaterial: THREE.MeshBasicMaterial;

  constructor() {
    this.texture = typeof document === 'undefined'
      ? new THREE.Texture()
      : new THREE.TextureLoader().load(TextureAtlas.url('entity/arrow'));
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.material = createEntityMaterial({
      map: this.texture,
      alphaTest: 0.08,
      side: THREE.DoubleSide,
    });
    this.flamingMaterial = createEntityMaterial({
      map: this.texture, alphaTest: 0.08, side: THREE.DoubleSide, color: 0xff7a22,
    });
  }

  create(flaming = false): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry, flaming ? this.flamingMaterial : this.material);
    mesh.name = flaming ? 'fire-arrow-projectile' : 'arrow-projectile';
    bindEntityLightReceiver(mesh);
    return mesh;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.flamingMaterial.dispose();
    this.texture.dispose();
  }
}

export function createArrowGeometry(): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  type Point = readonly [number, number, number];
  // Actual authored 64×64 sheet: two mirrored 32×10 profiles across the top.
  // The first points toward +U: feathers x0..8, wood x8..26, head x26..31.
  // Pixel centers avoid transparent adjacent rows; U follows longitudinal +Z.
  const quad = (points: readonly Point[], rect: readonly [number, number, number, number]): void => {
    const start = positions.length / 3;
    for (const p of points) positions.push(...p);
    const [x0, y0, x1, y1] = rect;
    uvs.push(x0 / 64, 1 - y0 / 64, x1 / 64, 1 - y0 / 64,
      x1 / 64, 1 - y1 / 64, x0 / 64, 1 - y1 / 64);
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };
  const r = 0.014, rear = -0.82, front = -0.025;
  const wood = [8.5, 4.5, 25.5, 5.5] as const;
  quad([[-r, r, rear], [-r, r, front], [r, r, front], [r, r, rear]], wood);
  quad([[r, -r, rear], [r, -r, front], [-r, -r, front], [-r, -r, rear]], wood);
  quad([[r, r, rear], [r, r, front], [r, -r, front], [r, -r, rear]], wood);
  quad([[-r, -r, rear], [-r, -r, front], [-r, r, front], [-r, r, rear]], wood);
  quad([[-r, -r, rear], [-r, r, rear], [r, r, rear], [r, -r, rear]], wood);
  // Small solid pyramid; 0.065 tip accounts for both managers' 0.035 hit backoff.
  // No change to collision, damage, trajectory or embedded simulation position.
  const h = 0.035;
  const ring: Point[] = [[-h, -h, front], [h, -h, front], [h, h, front], [-h, h, front]];
  for (let side = 0; side < 4; side++) {
    const start = positions.length / 3;
    positions.push(...ring[side]!, ...ring[(side + 1) % 4]!, 0, 0, 0.065);
    uvs.push(28.5 / 64, 1 - 3.5 / 64, 28.5 / 64, 1 - 5.5 / 64, 30.5 / 64, 1 - 4.5 / 64);
    indices.push(start, start + 1, start + 2);
  }
  // Only the rear quarter has crossed alpha-cutout feathers (not full arrows).
  quad([[-0.085, 0, rear], [-0.085, 0, -0.60], [0.085, 0, -0.60], [0.085, 0, rear]], [0, 0, 9, 10]);
  quad([[0, 0.085, rear], [0, 0.085, -0.60], [0, -0.085, -0.60], [0, -0.085, rear]], [0, 0, 9, 10]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
