"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthenticatedUser } from "@/features/auth/session";
import { isStrongPassword, PASSWORD_MIN_LENGTH } from "@/features/auth/password";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types";

export interface AuthAccountWithoutProfile {
  id: string;
  email: string;
  createdAt: string;
}

/**
 * Server-side, token-revalidated "active System Administrator" check —
 * required before `createSupabaseAdminClient()` is ever constructed.
 *
 * Deliberately does NOT use `getCurrentUserIdentity()` / `useCurrentIdentity()`.
 * Both are documented in their own source as "presentation authority only":
 * they read `profiles.role` with no `active` filter, which is fine everywhere
 * RLS backstops them — an account that defeats the UI check still gets a
 * write refused by policy. That assumption does not hold here: the
 * service-role client this guards BYPASSES RLS entirely, so this check has to
 * BE the real boundary, not just render correctly around one.
 *
 * So this independently re-derives the caller with `auth.getUser()` (never
 * the cookie-trusting `getSession()`), then reads their own row through the
 * ordinary RLS-protected client (`profiles_select_own` — `id = auth.uid()`,
 * true regardless of `active`, so a deactivated account can still be told
 * why it was refused) and requires BOTH `role = 'system_admin'` AND
 * `active = true` before letting the caller through. Neither
 * `getCurrentUserIdentity()`, `useCurrentIdentity()`, nor `proxy.ts` is
 * touched — this is a local, self-contained check for this one action.
 */
async function requireActiveSystemAdmin(): Promise<void> {
  const user = await getAuthenticatedUser();
  if (!user) {
    throw new Error("Sign in required.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  // See admin-users/data.ts: `.select()` on `profiles` resolves to `never`
  // under the generated `Database` type, so the result is cast explicitly.
  const profile = data as { role: string; active: boolean } | null;

  if (!profile || profile.role !== "system_admin" || !profile.active) {
    throw new Error(
      "Only an active System Administrator can view authentication accounts."
    );
  }
}

/**
 * Supabase Auth accounts that have no `profiles` row yet — the pool "Select
 * Auth Account" links from.
 *
 * Naming matters here: a returned account has no PLATFORM PROFILE at all
 * (`profiles` row), which is a different fact from a profile having no
 * PERSON linked (`profiles.contact_id is null`, surfaced elsewhere as
 * "Person Not Linked"). Never call either state "unlinked" on its own — say
 * which link is missing.
 *
 * Read-only: creates no account, no profile. Accounts are created in
 * Supabase Auth by a System Administrator outside this app
 * (`20260729000001_profiles.sql`); this is the first UI consumer of
 * `createSupabaseAdminClient()`, gated by {@link requireActiveSystemAdmin} so
 * the service-role key is never reachable by a non-admin, or deactivated
 * admin, request.
 */
export async function listAuthAccountsWithoutProfile(): Promise<
  AuthAccountWithoutProfile[]
> {
  await requireActiveSystemAdmin();

  const supabase = await createSupabaseServerClient();
  const { data: existing, error: profilesError } = await supabase
    .from("profiles")
    .select("id");
  if (profilesError) throw new Error(profilesError.message);
  // See admin-users/data.ts: `.select()` on `profiles` resolves to `never`
  // under the generated `Database` type, so the result is cast explicitly.
  const withProfile = new Set(
    ((existing ?? []) as { id: string }[]).map((row) => row.id)
  );

  const admin = createSupabaseAdminClient();

  // `@supabase/auth-js` serializes `page`/`perPage` straight into the query
  // string (`GoTrueAdminApi.listUsers`) even when omitted — an omitted `page`
  // becomes a literal `page=` (empty), which the local GoTrue instance
  // rejects. Both must always be passed explicitly.
  let data: Awaited<ReturnType<typeof admin.auth.admin.listUsers>>["data"];
  try {
    const result = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (result.error) {
      const status =
        typeof result.error.status === "number"
          ? ` (HTTP ${result.error.status})`
          : "";
      // `auth-js` only parses the JSON error body for 4xx responses; for a
      // 5xx it deliberately treats the failure as "retryable" and derives the
      // message from the raw fetch Response object instead, which stringifies
      // to "{}" — so the status is always shown, and that placeholder is
      // replaced with something that actually says what's known rather than
      // an empty object.
      const rawMessage = result.error.message?.trim();
      const message =
        rawMessage && rawMessage !== "{}"
          ? rawMessage
          : "The login account service rejected the request with no further detail available. Check the server logs for the underlying cause.";
      throw new Error(`Login account service error${status}: ${message}`);
    }
    data = result.data;
  } catch (err) {
    // Normalize whatever GoTrue/fetch threw (an AuthError, a raw fetch
    // failure, or anything else) into a real message — never let a
    // Response/URL/Request object reach the UI unserialized.
    if (err instanceof Error) throw err;
    throw new Error(`Login account service request failed: ${String(err)}`);
  }

  return data.users
    .filter((user) => !!user.email && !withProfile.has(user.id))
    .map((user) => ({
      id: user.id,
      email: user.email as string,
      createdAt: user.created_at,
    }));
}

export interface CreateUserAccountInput {
  email: string;
  password: string;
  contactId: string | null;
  role: UserRole;
  active: boolean;
}

export interface CreateUserAccountResult {
  /** "profile_incomplete" means the Auth account now exists and can be
   * finished from Link Existing Account, but the profile write itself
   * failed — never a duplicate Auth account, never a silent no-op. */
  status: "created" | "profile_incomplete";
  profileId: string;
}

/**
 * Creates a platform user directly: a Supabase Auth account with a password
 * the admin sets (no invitation email), plus its `profiles` row. Gated by
 * the same {@link requireActiveSystemAdmin} boundary as every other action
 * here that touches `createSupabaseAdminClient()`.
 *
 * No `auth.users` trigger provisions `profiles` in this schema (confirmed —
 * no migration defines one), so the profile row is created explicitly here,
 * the same established pattern the existing "Link Existing Account" flow
 * already uses for a pre-existing Auth user.
 */
export async function createUserAccount(
  input: CreateUserAccountInput
): Promise<CreateUserAccountResult> {
  await requireActiveSystemAdmin();

  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid login email.");
  }
  if (!isStrongPassword(input.password)) {
    throw new Error(
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include an uppercase letter, a lowercase letter, and a number.`
    );
  }

  const admin = createSupabaseAdminClient();

  // Pre-check within the same 200-account window `listAuthAccountsWithoutProfile`
  // already uses: report precisely which link is missing rather than
  // surfacing GoTrue's own duplicate-email error, and never attempt to
  // create a second Auth account for an email that already has one.
  const { data: existingUsers, error: listError } =
    await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listError) {
    throw new Error(
      `Could not verify existing accounts before creating this one: ${listError.message}`
    );
  }
  const existingAuthUser = existingUsers.users.find(
    (user) => user.email?.toLowerCase() === email
  );

  const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;

  if (existingAuthUser) {
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", existingAuthUser.id)
      .maybeSingle();
    if (existingProfile) {
      throw new Error("This login account already has a platform profile.");
    }
    throw new Error(
      "This login email already exists as a login account without a platform profile. Use Link Existing Account to finish setting it up."
    );
  }

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
    });
  if (createError) {
    // Profile state is not known here — this email fell outside the 200-row
    // pre-check above, so unlike the confirmed cases (lines 208-213), whether
    // it already has a platform profile has not actually been checked.
    if (createError.code === "email_exists") {
      throw new Error(
        "This login account already exists. Use Link Existing Account to check or complete its platform profile."
      );
    }
    throw new Error(`Could not create the login account: ${createError.message}`);
  }
  const authUser = created.user;
  if (!authUser) {
    throw new Error("Auth account creation did not return a user.");
  }

  // Best-effort display name: the linked Contact's name when one was chosen,
  // otherwise the login email — same fallback the existing Link Existing
  // Account flow already uses. Never blocks account creation on its own.
  let fullName = email;
  if (input.contactId) {
    const { data: contactRow } = await supabase
      .from("contacts")
      .select("name")
      .eq("id", input.contactId)
      .maybeSingle();
    const name = (contactRow as { name?: string } | null)?.name;
    if (name) fullName = name;
  }

  const { error: profileError } = await supabase.from("profiles").insert({
    id: authUser.id,
    email,
    full_name: fullName,
    role: input.role,
    contact_id: input.contactId,
    active: input.active,
  });

  if (profileError) {
    return { status: "profile_incomplete", profileId: authUser.id };
  }

  return { status: "created", profileId: authUser.id };
}
