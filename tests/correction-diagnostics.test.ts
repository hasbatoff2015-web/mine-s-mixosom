import { describe, expect, it } from 'vitest';
import { isCorrDiagQueryEnabled } from '../src/net/correctionDiagnostics';

describe('correction diagnostics flags', () => {
  it('enables on corrDiag or motionDiag query', () => {
    expect(isCorrDiagQueryEnabled('')).toBe(false);
    expect(isCorrDiagQueryEnabled('?corrDiag=1')).toBe(true);
    expect(isCorrDiagQueryEnabled('?motionDiag=1')).toBe(true);
    expect(isCorrDiagQueryEnabled('?foo=1')).toBe(false);
  });
});
