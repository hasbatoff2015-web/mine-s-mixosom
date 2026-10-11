export class EconomyValidationError extends Error {
  readonly code = 'ECONOMY_VALIDATION' as const;

  constructor(message: string) {
    super(message);
    this.name = 'EconomyValidationError';
  }
}

export class EconomyInsufficientError extends Error {
  readonly code = 'ECONOMY_INSUFFICIENT' as const;

  constructor() {
    super('insufficient balance');
    this.name = 'EconomyInsufficientError';
  }
}

export class EconomyLimitError extends Error {
  readonly code = 'ECONOMY_LIMIT' as const;

  constructor() {
    super('balance limit exceeded');
    this.name = 'EconomyLimitError';
  }
}

/** The same source identity was reused for a different economic result. */
export class EconomySourceConflictError extends Error {
  readonly code = 'ECONOMY_SOURCE_CONFLICT' as const;

  constructor() {
    super('economic source was already used with a different result');
    this.name = 'EconomySourceConflictError';
  }
}

export class EconomyAccountNotFoundError extends Error {
  readonly code = 'ECONOMY_ACCOUNT_NOT_FOUND' as const;

  constructor() {
    super('account not found');
    this.name = 'EconomyAccountNotFoundError';
  }
}
