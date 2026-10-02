/**
 * Pins the game to the visual viewport.
 * `100vh` is the layout viewport and stays tall while the mobile browser bar
 * covers the bottom, so `bottom: 0` HUD and menu footers sit under that bar.
 * Requesting the desktop site scales a wide layout viewport to the screen and
 * hides the mismatch. `visualViewport` is the area that is actually visible.
 */
export function bindVisualViewport(target: HTMLElement = document.documentElement): () => void {
  const apply = (): void => {
    const viewport = window.visualViewport;
    const height = viewport?.height ?? window.innerHeight;
    const offsetTop = viewport?.offsetTop ?? 0;
    if (!(height > 0)) return;
    target.style.setProperty('--app-height', `${Math.round(height)}px`);
    target.style.setProperty('--app-offset-top', `${Math.round(offsetTop)}px`);
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
