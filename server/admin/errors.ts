export class AdminControlDisabledError extends Error {
  readonly code = 'ADMIN_DISABLED' as const;

  constructor() {
    super('Admin control-plane writes are disabled. Set FC_ADMIN_IDS to exactly two ids.');
    this.name = 'AdminControlDisabledError';
  }
}

export class AdminIdentityError extends Error {
  readonly code = 'ADMIN_FORBIDDEN' as const;

  constructor() {
    super('admin identity is not authorized');
    this.name = 'AdminIdentityError';
  }
}

export class AdminActionValidationError extends Error {
  readonly code = 'ADMIN_ACTION_VALIDATION' as const;

  constructor(message: string) {
    super(message);
    this.name = 'AdminActionValidationError';
  }
}

export class AdminInspectionError extends Error {
  readonly code = 'ADMIN_INSPECTION' as const;

  constructor(message: string) {
    super(message);
    this.name = 'AdminInspectionError';
  }
}
