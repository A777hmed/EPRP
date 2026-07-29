import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUserIdentity } from "../profile";

/**
 * Welcome card for the sidebar header (UI-only phase).
 *
 * An async Server Component: the name and role come from the signed-in
 * user's own `profiles` row, never from a hardcoded value. It streams behind
 * a Suspense boundary, so {@link SidebarWelcomeCardSkeleton} covers the wait.
 *
 * Hidden in the collapsed icon rail, matching how the logo lockup behaves.
 */
export async function SidebarWelcomeCard() {
  const identity = await getCurrentUserIdentity();

  // Signed out, or Supabase not configured — the shell still renders.
  if (!identity) return null;

  const firstName = identity.fullName.split(/\s+/)[0];

  return (
    <div
      className={[
        "group-data-[collapsible=icon]:hidden",
        "rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-2.5",
        "transition-colors hover:bg-sidebar-accent/60",
        // motion-safe only: reduced motion removes the entrance entirely.
        "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-500",
      ].join(" ")}
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground"
        >
          {identity.initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-sidebar-foreground">
            Hey, {firstName} <span aria-hidden="true">👋</span>
          </p>
          <p className="truncate text-xs text-sidebar-foreground/70">
            {identity.roleLabel ?? "No role assigned"}
          </p>
        </div>
      </div>
      <p className="mt-2 text-xs text-sidebar-foreground/60 text-pretty">
        Ready to review project performance?
      </p>
    </div>
  );
}

/** Shown while the profile is still loading. */
export function SidebarWelcomeCardSkeleton() {
  return (
    <div
      className="rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-2.5 group-data-[collapsible=icon]:hidden"
      aria-hidden="true"
    >
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-8 shrink-0 rounded-full bg-sidebar-foreground/10" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-24 bg-sidebar-foreground/10" />
          <Skeleton className="h-3 w-20 bg-sidebar-foreground/10" />
        </div>
      </div>
      <Skeleton className="mt-2 h-3 w-full bg-sidebar-foreground/10" />
    </div>
  );
}
