import { Suspense } from "react";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar, TopBar } from "@/components/layout";
import {
  SidebarWelcomeCard,
  SidebarWelcomeCardSkeleton,
} from "@/features/auth/components/sidebar-welcome-card";

/**
 * Application shell: sidebar + top bar around a responsive content area.
 * All product routes live inside this group; standalone pages (e.g.
 * /design-system) stay outside it.
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
    <SidebarProvider>
      <AppSidebar
        welcome={
          <Suspense fallback={<SidebarWelcomeCardSkeleton />}>
            <SidebarWelcomeCard />
          </Suspense>
        }
      />
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
