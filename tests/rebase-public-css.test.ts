import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rebaseBuiltPublicCss } from '../scripts/rebase-public-css';

describe('rebaseBuiltPublicCss', () => {
  it('points root-absolute public urls at the directory next to assets/*.css', () => {
    const css = [
      readFileSync('src/style.css', 'utf8'),
      readFileSync('src/uiTokens.css', 'utf8'),
    ].join('\n');
    const rewritten = rebaseBuiltPublicCss(css);
    expect(rewritten).not.toMatch(/url\((['"]?)\/(ui|fonts|textures|audio)\//);
    expect(rewritten).toContain("url('../ui/frontier-menu-background.png')");
    expect(rewritten).toContain('url("../fonts/inter/inter-cyrillic-400-700.woff2")');
    expect(rewritten).toContain('url("../fonts/press-start-2p/press-start-2p-latin-400.woff2")');
    expect(rewritten).not.toContain('/sdk.js');
    expect(rebaseBuiltPublicCss("url('https://cdn.example/ui/keep.png')")).toBe("url('https://cdn.example/ui/keep.png')");
  });
});
