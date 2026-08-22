import * as THREE from 'three';

/**
 * Minecraft-like GUI face weights: keep albedo readable, only a light 3D cue.
 * Never goes near black (terrain-style 0.5 bottom would crush oak/birch icons).
 */
export function specialIconFaceShade(nx: number, ny: number, nz: number): number {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ay >= ax && ay >= az) return ny >= 0 ? 1 : 0.78;
  if (az >= ax) return 0.9;
  return 0.84;
}

function applyFaceVertexColors(geometry: THREE.BufferGeometry): void {
  const normal = geometry.getAttribute('normal');
  if (!normal) return;
  const colors = new Float32Array(normal.count * 3);
  for (let index = 0; index < normal.count; index += 1) {
    const shade = specialIconFaceShade(normal.getX(index), normal.getY(index), normal.getZ(index));
    const offset = index * 3;
    colors[offset] = shade;
    colors[offset + 1] = shade;
    colors[offset + 2] = shade;
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

function previewMaterial(source: THREE.Material): THREE.MeshBasicMaterial {
  const preview = source.clone() as THREE.MeshBasicMaterial;
  preview.fog = false;
  preview.vertexColors = true;
  preview.toneMapped = false;
  preview.onBeforeCompile = () => undefined;
  preview.customProgramCacheKey = () => SPECIAL_ICON_PREVIEW_POLICY.programCacheKey;
  preview.needsUpdate = true;
  return preview;
}

/** Preview-only: strip shared entity-light hooks without mutating held/world meshes. */
export const SPECIAL_ICON_PREVIEW_POLICY = Object.freeze({
  autoFit: true,
  colorSpace: 'srgb' as const,
  unlitMaterial: true,
  stripsWorldLight: true,
  programCacheKey: 'special-icon-preview-unlit-v1',
});

export function prepareSpecialIconPreview(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.onBeforeRender = () => undefined;
    const source = child.material;
    if (Array.isArray(source)) {
      child.material = source.map((entry) => previewMaterial(entry));
    } else {
      child.material = previewMaterial(source);
    }
    child.geometry = child.geometry.clone();
    applyFaceVertexColors(child.geometry);
  });
}

export function disposeSpecialIconPreview(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const material = child.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material.dispose();
  });
}
