/** Pinch and Safari gesture zoom. A single finger is left alone so scroll and jump taps still arrive. */
export function shouldBlockTouchZoom(touchCount: number): boolean {
  return touchCount >= 2;
}

export function shouldBlockGestureZoom(type: string): boolean {
  return type === 'gesturestart' || type === 'gesturechange' || type === 'gestureend';
}

/** Stops page zoom. It does not call preventDefault on a one-finger pointer sequence. */
export function bindBrowserZoomLock(target: Document = document): () => void {
  const stopGesture = (event: Event): void => {
    if (shouldBlockGestureZoom(event.type)) event.preventDefault();
  };
  const stopPinch = (event: TouchEvent): void => {
    if (shouldBlockTouchZoom(event.touches.length)) event.preventDefault();
  };
  target.addEventListener('gesturestart', stopGesture, { passive: false });
  target.addEventListener('gesturechange', stopGesture, { passive: false });
  target.addEventListener('gestureend', stopGesture, { passive: false });
  target.addEventListener('touchmove', stopPinch, { passive: false });
  return () => {
    target.removeEventListener('gesturestart', stopGesture);
    target.removeEventListener('gesturechange', stopGesture);
    target.removeEventListener('gestureend', stopGesture);
    target.removeEventListener('touchmove', stopPinch);
  };
}
