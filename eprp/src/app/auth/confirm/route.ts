import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Landing point for Supabase auth emails (Phase A2.1).
 *
 * This is the URL that must be whitelisted in Supabase → Authentication →
 * URL Configuration → Redirect URLs.
 *
 * A Route Handler is used rather than a page because the token exchange has
 * to write session cookies, which a Server Component cannot reliably do.
 *
 * Both link formats are handled so the flow works whichever the project is
 * configured for: `token_hash` + `type` (the default recovery template) and
 * `code` (PKCE).
 */

/** Only same-origin relative paths, so the link cannot bounce elsewhere. */
function safeNext(value: string | null): string {
  if (!value) return "/reset-password";
  if (!/^\/(?!\/)/.test(value)) return "/reset-password";
  return value;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));

  const failed = new URL("/login", origin);
  failed.searchParams.set("error", "link_invalid");

  if (!isSupabaseConfigured()) return NextResponse.redirect(failed);

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await createSupabaseServerClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(new URL(next, origin));
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }

  // Expired, already used, or tampered with — say so generically on /login.
  return NextResponse.redirect(failed);
}
