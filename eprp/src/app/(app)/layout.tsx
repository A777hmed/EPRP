import { Suspense } from "react";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import {
  AppSidebar,
  ProjectContextSidebar,
  RouteSidebarSync,
  TopBar,
} from "@/components/layout";
import {
  SidebarWelcomeCard,
  SidebarWelcomeCardSkeleton,
} from "@/features/auth/components/sidebar-welcome-card";

/**
 * Application shell: a global icon rail, a contextual project sidebar
 * (desktop only, shown only inside a project), and a top bar around a
 * responsive content area. All product routes live inside this group;
 * standalone pages (e.g. /design-system) stay outside it.
 *
 * The rail's open/collapsed state follows the route category — expanded on
 * platform routes, compact inside a project — and is still fully
 * user-toggleable (trigger, `Cmd/Ctrl+B`) within either category.
 * `defaultOpen={true}` is the correct static default for the common,
 * global-route case (no flash there); `RouteSidebarSync` corrects it on
 * mount and on every crossing between global and project routes, so a
 * stale cookie or a manual collapse from a previous project visit can never
 * leave `/dashboard` starting collapsed. `ProjectContextSidebar` reacts to
 * the same shared sidebar context and temporarily collapses itself while
 * the rail is expanded, so the two never both show full width at once (see
 * `project-context-sidebar.tsx`).
 *
 * The welcome card arrives as a slot rather than being rendered inside
 * `AppSidebar`: the sidebar is a client component, so the card — which reads
 * the signed-in profile on the server — has to be composed here. Suspense
 * lets the shell paint straight away and swaps the skeleton for the real
 * card once the profile resolves.
 */
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SidebarProvider defaultOpen={true}>
      <RouteSidebarSync />
      <AppSidebar
        welcome={
          <Suspense fallback={<SidebarWelcomeCardSkeleton />}>
            <SidebarWelcomeCard />
          </Suspense>
        }
      />
      <ProjectContextSidebar />
      <SidebarInset>
        <TopBar />
        <main className="flex-1">
          <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
