import { invalidInput, invalidResponse } from "./errors.ts";

const INTEGER = /^(0|[1-9][0-9]*)$/;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/** True for a canonical, non-negative integer string such as "20000000". */
export function isBaseUnits(value: unknown): value is string {
  return typeof value === "string" && INTEGER.test(value);
}

/** Validate caller input in token base units. Zero is rejected unless allowed. */
export function baseUnits(value: unknown, what: string, allowZero = false): string {
  if (!isBaseUnits(value) || (!allowZero && value === "0")) {
    invalidInput(`${what} must be a positive integer string in token base units.`);
  }
  return value;
}

/** Validate provider output in token base units. */
export function responseUnits(value: unknown, what: string, allowZero = false): string {
  if (!isBaseUnits(value) || (!allowZero && value === "0")) {
    invalidResponse(`Invalid ${what}; expected an integer string in base units.`);
  }
  return value;
}

/**
 * Convert a human decimal string ("20.5") into base units. Rejects signs, exponents,
 * separators, and more fractional digits than the token supports. No floating point.
 */
export function toBaseUnits(decimal: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) invalidInput("Invalid token decimals.");
  const value = decimal.trim();
  if (!DECIMAL.test(value)) invalidInput("Enter an amount like 20 or 20.50.");
  const [whole = "0", fraction = ""] = value.split(".");
  if (fraction.length > decimals) invalidInput(`This token supports at most ${decimals} decimal places.`);
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  return units.toString();
}

/** Format base units for display. Truncates toward zero; never rounds up. */
export function formatUnits(units: string | bigint, decimals: number, maxFractionDigits = decimals): string {
  const value = typeof units === "bigint" ? units : BigInt(units);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale)
    .toString()
    .padStart(decimals, "0")
    .slice(0, Math.max(0, maxFractionDigits))
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

export function sumUnits(values: Iterable<string>): string {
  let total = 0n;
  for (const value of values) total += BigInt(value);
  return total.toString();
}

export function minUnits(a: string, b: string): string {
  return BigInt(a) <= BigInt(b) ? a : b;
}

/** a - b, floored at zero. */
export function subtractUnits(a: string, b: string): string {
  const result = BigInt(a) - BigInt(b);
  return (result > 0n ? result : 0n).toString();
}
