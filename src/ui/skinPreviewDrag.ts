export interface SkinPreviewPointerPoint {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly clientX: number;
}

/**
 * Pointer gesture for the skin-selector preview.
 * GameUI owns the DOM listeners; this only decides which pointer is dragging.
 */
export class SkinPreviewDragTracker {
  private pointerId: number | undefined;
  private lastX = 0;

  /** Primary mouse button, touch, and stylus. A second pointer does not take over. */
  begin(point: SkinPreviewPointerPoint): boolean {
    if (point.pointerType === 'mouse' && point.button !== 0) return false;
    if (this.pointerId !== undefined) return false;
    this.pointerId = point.pointerId;
    this.lastX = point.clientX;
    return true;
  }

  /** Horizontal pixel delta for the active pointer, otherwise undefined. */
  move(point: Pick<SkinPreviewPointerPoint, 'pointerId' | 'clientX'>): number | undefined {
    if (this.pointerId === undefined || point.pointerId !== this.pointerId) return undefined;
    const delta = point.clientX - this.lastX;
    this.lastX = point.clientX;
    return delta;
  }

  /** True when this pointer id ended the active drag. */
  end(pointerId: number): boolean {
    if (this.pointerId === undefined || pointerId !== this.pointerId) return false;
    this.pointerId = undefined;
    return true;
  }
}
