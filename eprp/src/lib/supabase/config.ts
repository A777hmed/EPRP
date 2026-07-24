/**
 * Supabase configuration helpers (Phase 5C).
 *
 * The app runs against mock data until these public env vars are set, at
 * which point the data services switch to Supabase automatically. Secret
 * keys are never read here — only the public URL + anon key.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when the public Supabase env vars are present. */
export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}
