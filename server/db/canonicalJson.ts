import { createHash } from 'node:crypto';

export class CanonicalJsonError extends Error {
  readonly code = 'CANONICAL_JSON' as const;

  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

/**
 * Deterministic JSON for idempotency identity.
 * Object keys are sorted by UTF-16 code unit. Array order is preserved.
 * JSON types stay distinct: 1, "1", and true encode differently.
 * Cyclic, sparse, and non-JSON values throw instead of hashing as a guess.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, new WeakSet());
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

function encode(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CanonicalJsonError('non-finite number');
    if (Object.is(value, -0)) return '0';
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint' || typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    throw new CanonicalJsonError(`unsupported ${typeof value}`);
  }
  if (typeof value !== 'object') throw new CanonicalJsonError('unsupported value');
  if (seen.has(value)) throw new CanonicalJsonError('cyclic value');

  if (Array.isArray(value)) {
    seen.add(value);
    try {
      for (const key of Object.keys(value)) {
        if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
          throw new CanonicalJsonError('unsupported array property');
        }
      }
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new CanonicalJsonError('unsupported symbol property');
      }
      const parts: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new CanonicalJsonError('sparse array');
        }
        parts.push(encode(value[index], seen));
      }
      return `[${parts.join(',')}]`;
    } finally {
      seen.delete(value);
    }
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError('unsupported object');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new CanonicalJsonError('unsupported symbol property');
  }
  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    throw new CanonicalJsonError('unsupported toJSON');
  }

  seen.add(value);
  try {
    const keys = Object.keys(value).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || descriptor.get || descriptor.set) {
        throw new CanonicalJsonError('unsupported property');
      }
      parts.push(`${JSON.stringify(key)}:${encode(descriptor.value, seen)}`);
    }
    for (const key of Object.getOwnPropertyNames(value)) {
      if (!Object.prototype.propertyIsEnumerable.call(value, key)) {
        throw new CanonicalJsonError('unsupported non-enumerable property');
      }
    }
    return `{${parts.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}
