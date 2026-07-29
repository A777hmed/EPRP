"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { validateNewPassword } from "./password";

/**
 * Password management server actions (Phase A2.1).
 *
 * Everything here runs with the caller's own session and the anon key — the
 * service-role key is never used, so a user can only ever change their own
 * password. No sign-up path is added.
 */

export interface PasswordFormState {
  error?: string;
  success?: string;
}

const NOT_CONFIGURED =
  "Authentication is not configured on this environment. Contact your administrator.";

/* ----------------------------- Change password ---------------------------- */

export async function changePassword(
  _prev: PasswordFormState,
  formData: FormData
): Promise<PasswordFormState> {
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmPassword") ?? "");

  if (!currentPassword) return { error: "Enter your current password." };

  const invalid = validateNewPassword(password, confirmation);
  if (invalid) return { error: invalid };

  if (password === currentPassword) {
    return { error: "The new password must be different from the current one." };
  }

  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user?.email) {
    return { error: "Your session has expired. Sign in again to continue." };
  }

  /*
   * Supabase's updateUser does not check the current password, so a stolen
   * session could otherwise change it silently. Re-authenticating with the
   * supplied current password is the verification step. It re-issues a
   * session for the same user, which is harmless.
   */
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (reauthError) {
    return { error: "Your current password is incorrect." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    // Surface Supabase's own policy messages (e.g. leaked-password checks)
    // without leaking anything about the account itself.
    return { error: error.message || "Could not update the password." };
  }

  return { success: "Your password has been updated." };
}

/* ----------------------------- Forgot password ---------------------------- */

/** Always the same reply, so the form cannot be used to discover accounts. */
const RESET_ACKNOWLEDGEMENT =
  "If that email address has an account, a password reset link is on its way. Check your inbox and spam folder.";

export async function requestPasswordReset(
  _prev: PasswordFormState,
  formData: FormData
): Promise<PasswordFormState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email || !email.includes("@")) {
    return { error: "Enter a valid email address." };
  }

  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };

  const requestHeaders = await headers();
  const origin =
    requestHeaders.get("origin") ??
    `https://${requestHeaders.get("host") ?? ""}`;

  const supabase = await createSupabaseServerClient();
  // Errors are deliberately swallowed: reporting them would reveal whether
  // the address exists, and rate limits would leak the same way.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/reset-password`,
  });

  return { success: RESET_ACKNOWLEDGEMENT };
}

/* ------------------------------ Reset password ---------------------------- */

export async function resetPassword(
  _prev: PasswordFormState,
  formData: FormData
): Promise<PasswordFormState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmPassword") ?? "");

  const invalid = validateNewPassword(password, confirmation);
  if (invalid) return { error: invalid };

  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };

  const supabase = await createSupabaseServerClient();

  // The recovery link established a session; without it there is nothing to
  // update, and this is what stops the page being used directly.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return {
      error:
        "This reset link is invalid or has expired. Request a new one to continue.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.message || "Could not update the password." };
  }

  // End the recovery session so the new password must actually be used.
  await supabase.auth.signOut();
  redirect("/login?reset=success");
}
