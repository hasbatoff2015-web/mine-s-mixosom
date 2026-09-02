/** Explicit persistence failure. Callers must not treat this as an empty world. */
export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(message: string, code: PersistenceErrorCode = 'corrupt') {
    super(message);
    this.name = 'PersistenceError';
    this.code = code;
  }
}

export type PersistenceErrorCode =
  | 'corrupt'
  | 'incomplete'
  | 'unsupported'
  | 'exists'
  | 'missing';
