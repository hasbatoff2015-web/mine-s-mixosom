import { describe, expect, it } from 'vitest';
import { CanonicalJsonError, canonicalJson, hashPayload } from '../../server/db/canonicalJson';

describe('canonical json', () => {
  it('hashes object keys independently of insertion order', () => {
    const left = hashPayload({ b: 1, a: { d: true, c: 'x' } });
    const right = hashPayload({ a: { c: 'x', d: true }, b: 1 });
    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps array order distinct', () => {
    expect(hashPayload([1, 2, 3])).not.toBe(hashPayload([3, 2, 1]));
    expect(canonicalJson([1, { b: 2, a: 1 }])).toBe('[1,{"a":1,"b":2}]');
  });

  it('preserves number, string, and boolean distinctions', () => {
    const hashes = [hashPayload(1), hashPayload('1'), hashPayload(true), hashPayload(false), hashPayload(null)];
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(canonicalJson(1)).toBe('1');
    expect(canonicalJson('1')).toBe('"1"');
    expect(canonicalJson(true)).toBe('true');
  });

  it('encodes nested objects deterministically and allows a shared child', () => {
    const shared = { n: 1 };
    const left = { z: { b: 1, a: [3, { d: 1, c: 2 }] }, a: true };
    const right = { a: true, z: { a: [3, { c: 2, d: 1 }], b: 1 } };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(canonicalJson(left)).toBe('{"a":true,"z":{"a":[3,{"c":2,"d":1}],"b":1}}');
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"n":1},"b":{"n":1}}');
  });

  it('treats negative zero as zero', () => {
    expect(canonicalJson(-0)).toBe('0');
    expect(hashPayload(-0)).toBe(hashPayload(0));
  });

  it('rejects cyclic and unsupported values', () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(cycle)).toThrow(/cyclic/);

    const sparse = [1, 2, 3];
    delete sparse[1];
    expect(() => canonicalJson(sparse)).toThrow(/sparse/);

    const extra = [1, 2];
    (extra as unknown as { extra: number }).extra = 3;
    expect(() => canonicalJson(extra)).toThrow(/array property/);

    expect(() => canonicalJson(undefined)).toThrow(/undefined/);
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
    expect(() => canonicalJson(() => 1)).toThrow(/function/);
    expect(() => canonicalJson(1n)).toThrow(/bigint/);
    expect(() => canonicalJson(Symbol('x'))).toThrow(/symbol/);
    expect(() => canonicalJson(new Date(0))).toThrow(/unsupported object/);

    const withJson = { a: 1, toJSON: () => 1 };
    expect(() => canonicalJson(withJson)).toThrow(/toJSON/);

    const hidden: Record<string, number> = {};
    Object.defineProperty(hidden, 'secret', { value: 1, enumerable: false });
    expect(() => canonicalJson(hidden)).toThrow(/non-enumerable/);

    const marked: Record<string, number> = { a: 1 };
    Object.defineProperty(marked, Symbol('s'), { value: 1 });
    expect(() => canonicalJson(marked)).toThrow(/symbol property/);
  });
});
