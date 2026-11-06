export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export class ValidationError extends ApiError {
  constructor(message: string) {
    super(400, 'validation_error', message);
  }
}
