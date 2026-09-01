import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('Phase 7 import boundaries', () => {
  it('shared simulation and server do not import Three/rendering/browser persistence', () => {
    const output = execFileSync(process.execPath, ['scripts/check-import-boundaries.mjs'], {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    expect(output).toContain('Import boundaries OK');
  });
});
