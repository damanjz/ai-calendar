export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    }
  }
}

export function badRequest(message, details) {
  return new ApiError(400, 'bad_request', message, details)
}

export function notFound(message, details) {
  return new ApiError(404, 'not_found', message, details)
}

export function conflictError(message, details) {
  return new ApiError(409, 'conflict', message, details)
}

export function unauthorized(message, details) {
  return new ApiError(401, 'unauthorized', message, details)
}

export function providerError(message, details) {
  return new ApiError(502, 'provider_error', message, details)
}
