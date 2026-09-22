export class GatewayError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function assertFound<T>(value: T | null | undefined, label: string): T {
  if (value == null) {
    throw new GatewayError(404, `${label} not found`);
  }

  return value;
}
