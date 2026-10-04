/** Radians of preview yaw per horizontal pointer pixel. About 69° per 100 px. */
export const SKIN_PREVIEW_DRAG_RADIANS_PER_PIXEL = 0.012;

export interface SkinPreviewDragActions {
  rotatePreview(deltaPixels: number): void;
  setPreviewRotationActive(active: boolean): void;
}

/**
 * Pointer yaw drag for the skin-selector preview canvas.
 * GameUI owns the gesture; the Three preview only receives yaw deltas.
 */
export function bindSkinPreviewDrag(surface: HTMLElement, actions: SkinPreviewDragActions): void {
  let activePointerId: number | undefined;
  let lastX = 0;

  const end = (event: PointerEvent): void => {
    if (activePointerId === undefined || event.pointerId !== activePointerId) return;
    activePointerId = undefined;
    surface.classList.remove('is-dragging');
    actions.setPreviewRotationActive(false);
  };

  surface.addEventListener('pointerdown', (event) => {
    if (activePointerId !== undefined) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    lastX = event.clientX;
    surface.classList.add('is-dragging');
    try {
      surface.setPointerCapture(event.pointerId);
    } catch {
      // Move events still rotate while the pointer stays over the canvas.
    }
    actions.setPreviewRotationActive(true);
  });

  surface.addEventListener('pointermove', (event) => {
    if (activePointerId === undefined || event.pointerId !== activePointerId) return;
    const delta = event.clientX - lastX;
    lastX = event.clientX;
    if (delta !== 0) actions.rotatePreview(delta);
  });

  surface.addEventListener('pointerup', end);
  surface.addEventListener('pointercancel', end);
  surface.addEventListener('lostpointercapture', end);
}
