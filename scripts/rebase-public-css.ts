/** Rewrite root-absolute public CSS urls so they resolve next to `assets/*.css`. */
export function rebaseBuiltPublicCss(css: string): string {
  return css.replace(/url\((['"]?)\/(ui|fonts|textures|audio)\//g, 'url($1../$2/');
}
