// App error with HTTP status. Thrown by routes, rendered by the app error
// handler. Client-facing messages are plain and specific (never stack traces
// in production).

export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (m: string) => new AppError(400, m);
export const unauthorized = (m: string) => new AppError(401, m);
export const forbidden = (m: string) => new AppError(403, m);
export const notFound = (m: string) => new AppError(404, m);
export const conflict = (m: string) => new AppError(409, m);
export const tooMany = (m: string) => new AppError(429, m);
