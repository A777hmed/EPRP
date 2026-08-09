"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isSupabaseUnreachable } from "@/lib/supabase/network";

/**
 * Sign-in / sign-out server actions (Phase A2).
 *
 * There is deliberately no sign-up action: accounts are created by the System
 * Administrator, and public registration is disabled in the Supabase
 * dashboard. Nothing here touches the service-role key.
 */

export interface SignInState {
  /** Shown above the form; deliberately generic. */
  error?: string;
}

/** Only allow same-origin relative paths, so `next` cannot become an open redirect. */
function safeNextPath(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "/dashboard";
  // Must start with a single "/" — rejects "//evil.com" and "https://evil.com".
  if (!/^\/(?!\/)/.test(value)) return "/dashboard";
  if (value.startsWith("/login")) return "/dashboard";
  return value;
}

export async function signIn(
  _prevState: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next"));

  if (!email || !password) {
    return { error: "Enter your email address and password." };
  }

  if (!isSupabaseConfigured()) {
    return {
      error:
        "Authentication is not configured on this environment. Contact your administrator.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    /*
     * A connectivity failure is not a wrong password. Reporting it as one
     * sent people round in circles retyping a password that was correct all
     * along, so the two are separated here. This says nothing about whether
     * the account exists, so it does not weaken the generic reply below.
     */
    if (isSupabaseUnreachable(error)) {
      return {
        error:
          "Could not reach the authentication service. Check your connection and try again.",
      };
    }
    // Deliberately generic: never reveal whether the address has an account.
    return { error: "Incorrect email address or password." };
  }

  redirect(next);
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
