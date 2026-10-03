/**
 * Pins the game to the visual viewport.
 * `100vh` / `window.innerHeight` is the layout viewport and stays tall while
 * the mobile browser bar covers the bottom. `visualViewport` is the area
 * that is actually visible. Renderer, camera and CSS all read this helper.
 */
export interface ViewportReading {
  readonly visualViewport: { readonly width: number; readonly height: number } | null;
  readonly innerWidth: number;
  readonly innerHeight: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export function viewportMetrics(reading?: ViewportReading): ViewportSize {
  const visual = reading
    ? reading.visualViewport
    : (typeof window !== 'undefined' ? window.visualViewport : null);
  const innerWidth = reading?.innerWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1);
  const innerHeight = reading?.innerHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 1);
  const width = visual && visual.width > 0 ? visual.width : innerWidth;
  const height = visual && visual.height > 0 ? visual.height : innerHeight;
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

export function bindVisualViewport(target: HTMLElement = document.documentElement): () => void {
  const apply = (): void => {
    const size = viewportMetrics();
    const viewport = window.visualViewport;
    target.style.setProperty('--app-width', `${size.width}px`);
    target.style.setProperty('--app-height', `${size.height}px`);
    target.style.setProperty('--app-offset-top', `${Math.round(viewport?.offsetTop ?? 0)}px`);
    target.style.setProperty('--app-offset-left', `${Math.round(viewport?.offsetLeft ?? 0)}px`);
  };
  apply();
  window.visualViewport?.addEventListener('resize', apply);
  window.visualViewport?.addEventListener('scroll', apply);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  return () => {
    window.visualViewport?.removeEventListener('resize', apply);
    window.visualViewport?.removeEventListener('scroll', apply);
    window.removeEventListener('resize', apply);
    window.removeEventListener('orientationchange', apply);
  };
}
