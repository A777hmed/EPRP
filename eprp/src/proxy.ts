import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

/**
 * Session refresh and coarse route gating (Phase A2).
 *
 * Next.js 16 renamed the `middleware` file convention to `proxy` — see
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`.
 * The file must export a function named `proxy` (or a default export), and it
 * runs on the Node.js runtime by default in v16.
 *
 * This is **not** the authorization boundary. It refreshes the auth cookie and
 * redirects obvious cases so unauthenticated visitors never see an app shell.
 * Real enforcement is Row Level Security in the database, plus `getUser()`
 * checks in server code. A proxy check alone must never be relied on.
 */

/** Routes reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  // Landing point for Supabase auth emails; it establishes the session.
  "/auth",
];

/**
 * Public routes a signed-in user should be bounced away from.
 *
 * Deliberately excludes /reset-password and /auth: a recovery link signs the
 * user in first, so redirecting authenticated visitors would make the reset
 * page unreachable exactly when it is needed.
 */
const REDIRECT_WHEN_AUTHENTICATED = ["/login", "/forgot-password"];

function matches(paths: string[], pathname: string): boolean {
  return paths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

export async function proxy(request: NextRequest) {
  // Without Supabase env vars the app runs on mock data; gating every route
  // would make it unusable, so pass straight through.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return NextResponse.next();

  // Start from a response we can attach refreshed cookies to.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() revalidates against the auth server and refreshes the cookie.
  // Never getSession() here — it trusts the cookie without verifying it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && !matches(PUBLIC_PATHS, pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Preserve where they were heading so sign-in can return them there.
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (user && matches(REDIRECT_WHEN_AUTHENTICATED, pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  /**
   * Everything except Next internals and static assets. Auth routes are
   * handled inside `proxy` rather than excluded here, so a signed-in user
   * hitting /login still gets redirected.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map)$).*)",
  ],
};
