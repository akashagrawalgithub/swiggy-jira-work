class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'HttpError';
  }
}

export function createError(statusCode: number, message: string): HttpError {
  return new HttpError(statusCode, message);
}
