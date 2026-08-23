import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Turning a database failure into something a user should read.
 *
 * THE RULE: a raw PostgreSQL message never reaches the screen. Constraint
 * names, table names and phrases like "violates row-level security policy" are
 * diagnostics, not user-facing text — and worse than merely ugly, they mislead.
 *
 * That is not hypothetical. A signed-out session and a genuine lack of
 * authority produce the SAME RLS message, and reading it literally sent a real
 * investigation hunting for a permission bug in the milestone register that did
 * not exist; the session had simply lapsed when the database restarted.
 *
 * Shared by the milestone and deliverable services so the two cannot drift.
 * What stays per-service is the CONSTRAINT dictionary — each has its own — and
 * the wording of "you may not do this here", which names the register in
 * question.
 */

/** A PostgREST failure, without depending on the client's own error type. */
export interface ServiceError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/** 42501 is insufficient_privilege, which is what a refused RLS write raises. */
export function isPermissionDenied(error: ServiceError): boolean {
  return (
    error.code === "42501" || /row-level security/i.test(error.message ?? "")
  );
}

/**
 * Which kind of "no" this was.
 *
 * A Supabase client whose token has expired falls back to the anonymous key and
 * keeps working — so the write is refused for a reason that has nothing to do
 * with the user's authority, and telling them they lack permission would be
 * wrong. Checking for a live session separates the two, and gives each one an
 * action the user can actually take.
 */
async function permissionMessage(deniedMessage: string): Promise<string> {
  try {
    const client = getSupabaseBrowserClient() as unknown as SupabaseClient;
    const { data } = await client.auth.getSession();
    if (!data.session) {
      return "Your sign-in session has expired. Sign in again and retry — nothing was saved.";
    }
  } catch {
    // The session lookup itself failed; fall through to the authority wording
    // rather than inventing a cause.
  }
  return deniedMessage;
}

/**
 * The full error, kept for diagnosis and never shown.
 *
 * Only the wording changes — nothing is swallowed.
 */
function logFailure(
  scope: string,
  operation: string,
  error: ServiceError
): void {
  console.error(`[${scope}] ${operation} failed`, {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
}

export interface FailureOptions {
  /** The service reporting, e.g. "deliverable-service". */
  scope: string;
  /** What was being attempted, in plain words, e.g. "create the deliverable". */
  operation: string;
  error: ServiceError;
  /**
   * A recognised constraint violation, already worded for the user. Undefined
   * when the service does not recognise the message — which is exactly when a
   * raw echo would have leaked.
   */
  known?: string;
  /** Shown when the caller is signed in but genuinely lacks authority. */
  deniedMessage: string;
  /** Shown when nothing else fits. Never contains database text. */
  fallback: string;
}

/**
 * The single exit for a failed database call.
 *
 * Order matters: a recognised constraint is the most specific and most useful
 * thing to say, so it wins over the permission wording even when both could
 * apply.
 */
export async function describeFailure(
  options: FailureOptions
): Promise<Error> {
  logFailure(options.scope, options.operation, options.error);

  if (options.known) return new Error(options.known);
  if (isPermissionDenied(options.error)) {
    return new Error(await permissionMessage(options.deniedMessage));
  }
  return new Error(options.fallback);
}
