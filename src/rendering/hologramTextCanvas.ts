import * as THREE from 'three';
import {
  HOLOGRAM_TEXT_FONT_PX,
  HOLOGRAM_TEXT_LOGICAL_HEIGHT,
  HOLOGRAM_TEXT_LOGICAL_WIDTH,
  hologramTextPhysicalSize,
} from '../../shared/hologramStyle';

/**
 * Shared canvas/texture helpers for hologram-quality text.
 * World holograms and player nameplates both rasterize through this path.
 */
export function hologramDevicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  const dpr = window.devicePixelRatio;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

export function configureHologramTextTexture(texture: THREE.CanvasTexture): void {
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
}

export function createHologramTextCanvas(
  devicePixelRatio = hologramDevicePixelRatio(),
  logicalWidth = HOLOGRAM_TEXT_LOGICAL_WIDTH,
  logicalHeight = HOLOGRAM_TEXT_LOGICAL_HEIGHT,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const size = hologramTextPhysicalSize(logicalWidth, logicalHeight, devicePixelRatio);
  canvas.width = size.width;
  canvas.height = size.height;
  return canvas;
}

export function ensureHologramTextCanvasResolution(
  canvas: HTMLCanvasElement,
  scale: number,
  logicalWidth = HOLOGRAM_TEXT_LOGICAL_WIDTH,
  logicalHeight = HOLOGRAM_TEXT_LOGICAL_HEIGHT,
): void {
  const width = logicalWidth * scale;
  const height = logicalHeight * scale;
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
}

let fontsReady = false;
let fontsLoading = false;
const fontListeners: Array<() => void> = [];

export function loadHologramCanvasFonts(onReady?: () => void): void {
  if (onReady) {
    if (fontsReady) {
      onReady();
      return;
    }
    fontListeners.push(onReady);
  }
  if (fontsReady || fontsLoading) return;
  if (typeof document === 'undefined' || !document.fonts) return;
  fontsLoading = true;
  const sizes = [HOLOGRAM_TEXT_FONT_PX, 44, HOLOGRAM_TEXT_FONT_PX * 2, HOLOGRAM_TEXT_FONT_PX * 4];
  void Promise.all([
    ...sizes.flatMap((px) => [
      document.fonts.load(`700 ${px}px "Inter"`),
      document.fonts.load(`400 ${px}px "Inter"`),
      document.fonts.load(`400 ${px}px "Press Start 2P"`),
      document.fonts.load(`bold ${px}px "Press Start 2P"`),
    ]),
    document.fonts.ready,
  ]).then(() => {
    fontsReady = true;
    fontsLoading = false;
    for (const listener of fontListeners.splice(0)) listener();
  });
}
