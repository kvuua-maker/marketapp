export class AppError extends Error {
  constructor(message, { code = 'internal_error', status = 500, details = undefined } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message, details) {
    super(message, { code: 'validation_error', status: 422, details });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message) {
    super(message, { code: 'not_found', status: 404 });
    this.name = 'NotFoundError';
  }
}

export class UpstreamError extends AppError {
  constructor(message, details) {
    super(message, { code: 'upstream_error', status: 502, details });
    this.name = 'UpstreamError';
  }
}

export class NotConfiguredError extends AppError {
  constructor(message) {
    super(message, { code: 'not_configured', status: 409 });
    this.name = 'NotConfiguredError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message) {
    super(message, { code: 'unauthorized', status: 401 });
    this.name = 'UnauthorizedError';
  }
}

export class RateLimitError extends AppError {
  constructor(message) {
    super(message, { code: 'rate_limited', status: 429 });
    this.name = 'RateLimitError';
  }
}

export function toPublicError(error) {
  const isAppError = error instanceof AppError;
  return {
    code: isAppError ? error.code : 'internal_error',
    message: isAppError ? error.message : 'Unexpected server error',
    details: isAppError ? error.details : undefined,
  };
}
