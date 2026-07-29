/**
 * Password strength rules (Phase A2.1).
 *
 * Pure functions with no imports, so the same rules run in the client for
 * live feedback and again in the server action — the client copy is a
 * convenience, the server copy is the one that decides.
 */

export const PASSWORD_MIN_LENGTH = 10;

export interface PasswordRule {
  id: string;
  label: string;
  test: (value: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (value) => value.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "upper",
    label: "One uppercase letter",
    test: (value) => /[A-Z]/.test(value),
  },
  {
    id: "lower",
    label: "One lowercase letter",
    test: (value) => /[a-z]/.test(value),
  },
  { id: "digit", label: "One number", test: (value) => /\d/.test(value) },
];

/** Rule ids the value fails. Empty means the password is acceptable. */
export function failedPasswordRules(value: string): string[] {
  return PASSWORD_RULES.filter((rule) => !rule.test(value)).map(
    (rule) => rule.id
  );
}

export function isStrongPassword(value: string): boolean {
  return failedPasswordRules(value).length === 0;
}

/**
 * Validate a new password plus its confirmation. Returns a message for the
 * first problem found, or undefined when the pair is acceptable.
 */
export function validateNewPassword(
  password: string,
  confirmation: string
): string | undefined {
  if (!password) return "Enter a new password.";
  if (!isStrongPassword(password)) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include an uppercase letter, a lowercase letter, and a number.`;
  }
  if (password !== confirmation) return "The two passwords do not match.";
  return undefined;
}
