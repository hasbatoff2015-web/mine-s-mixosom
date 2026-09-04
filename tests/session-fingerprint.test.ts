import { describe, expect, it } from 'vitest';
import { sessionTokenFingerprint } from '../shared/sessionFingerprint';

describe('sessionTokenFingerprint', () => {
  it('is stable, short, and not the raw token', () => {
    const token = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const fp = sessionTokenFingerprint(token);
    expect(fp).toHaveLength(8);
    expect(fp).not.toContain(token);
    expect(sessionTokenFingerprint(token)).toBe(fp);
    expect(sessionTokenFingerprint('other-token')).not.toBe(fp);
  });
});
