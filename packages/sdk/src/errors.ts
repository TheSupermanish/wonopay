export type WonoErrorCode =
  | "INVALID_INPUT"
  | "INVALID_RESPONSE"
  | "QUOTE_MISMATCH"
  | "HTTP_ERROR"
  | "NETWORK_ERROR"
  | "RPC_ERROR";

export interface WonoErrorOptions {
  status?: number;
  /** Message returned by the provider, with credentials removed. Safe to display. */
  providerMessage?: string;
}

export class WonoError extends Error {
  readonly code: WonoErrorCode;
  readonly status: number | undefined;
  readonly providerMessage: string | undefined;

  constructor(code: WonoErrorCode, message: string, options: WonoErrorOptions = {}) {
    super(message);
    this.name = "WonoError";
    this.code = code;
    this.status = options.status;
    this.providerMessage = options.providerMessage;
  }
}

export function invalidInput(message: string): never {
  throw new WonoError("INVALID_INPUT", message);
}

export function invalidResponse(message: string): never {
  throw new WonoError("INVALID_RESPONSE", message);
}

export function quoteMismatch(message: string): never {
  throw new WonoError("QUOTE_MISMATCH", message);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function record(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) invalidResponse(`Expected ${what} to be an object.`);
  return value;
}

export function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    invalidResponse(`Invalid ${what}.`);
  }
  return value;
}

export function optionalText(value: unknown, what: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, what);
}
