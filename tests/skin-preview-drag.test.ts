import { describe, expect, it, vi } from 'vitest';
import { bindSkinPreviewDrag } from '../src/ui/skinPreviewDrag';

function dragHarness() {
  const listeners = new Map<string, (event: PointerEvent) => void>();
  const classes = new Set<string>();
  const surface = {
    classList: {
      add: (token: string) => { classes.add(token); },
      remove: (token: string) => { classes.delete(token); },
    },
    setPointerCapture: vi.fn(),
    addEventListener: (type: string, listener: EventListener) => {
      listeners.set(type, listener as (event: PointerEvent) => void);
    },
  };
  const actions = {
    rotatePreview: vi.fn(),
    setPreviewRotationActive: vi.fn(),
  };
  bindSkinPreviewDrag(surface as unknown as HTMLElement, actions);
  const fire = (type: string, init: Partial<PointerEvent> = {}): void => {
    listeners.get(type)?.({
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 0,
      preventDefault() {},
      ...init,
    } as PointerEvent);
  };
  return { actions, classes, fire, capture: surface.setPointerCapture };
}

describe('skin preview pointer drag', () => {
  it('pauses on primary pointer down, rotates by horizontal pixels, and resumes on release', () => {
    const { actions, classes, fire, capture } = dragHarness();
    fire('pointerdown', { clientX: 10 });
    expect(actions.setPreviewRotationActive).toHaveBeenCalledWith(true);
    expect(classes.has('is-dragging')).toBe(true);
    expect(capture).toHaveBeenCalledWith(1);
    fire('pointermove', { clientX: 40 });
    expect(actions.rotatePreview).toHaveBeenCalledWith(30);
    fire('pointerup');
    expect(actions.setPreviewRotationActive).toHaveBeenLastCalledWith(false);
    expect(classes.has('is-dragging')).toBe(false);
  });

  it('resumes auto rotation when the pointer is cancelled', () => {
    const { actions, fire } = dragHarness();
    fire('pointerdown');
    fire('pointercancel');
    expect(actions.setPreviewRotationActive).toHaveBeenLastCalledWith(false);
  });

  it('ignores the right mouse button', () => {
    const { actions, classes, fire } = dragHarness();
    fire('pointerdown', { button: 2, pointerType: 'mouse' });
    fire('pointermove', { clientX: 30 });
    expect(actions.setPreviewRotationActive).not.toHaveBeenCalled();
    expect(actions.rotatePreview).not.toHaveBeenCalled();
    expect(classes.has('is-dragging')).toBe(false);
  });

  it('does not let a second pointer steal the active drag', () => {
    const { actions, fire } = dragHarness();
    fire('pointerdown', { pointerId: 1, clientX: 0 });
    fire('pointerdown', { pointerId: 2, clientX: 80, pointerType: 'touch', button: 0 });
    fire('pointermove', { pointerId: 2, clientX: 110 });
    expect(actions.rotatePreview).not.toHaveBeenCalled();
    fire('pointermove', { pointerId: 1, clientX: 30 });
    expect(actions.rotatePreview).toHaveBeenCalledTimes(1);
    expect(actions.rotatePreview).toHaveBeenCalledWith(30);
    expect(actions.setPreviewRotationActive).toHaveBeenCalledTimes(1);
  });
});
