/**
 * Client-side "Generate Password" helper for Create New Account.
 *
 * Uses `crypto.getRandomValues` (never `Math.random`) and always satisfies
 * the existing password policy in `@/features/auth/password` (length,
 * uppercase, lowercase, digit). The result lives only in the dialog's React
 * state until submitted — nothing here persists or transmits it anywhere.
 */

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no ambiguous I/O
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_=+";
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

function randomIndex(max: number): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] % max;
}

function randomChar(charset: string): string {
  return charset[randomIndex(charset.length)];
}

export function generateStrongPassword(length = 14): string {
  const required = [randomChar(UPPER), randomChar(LOWER), randomChar(DIGITS)];
  const rest = Array.from({ length: Math.max(0, length - required.length) }, () =>
    randomChar(ALL)
  );
  const chars = [...required, ...rest];

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}
