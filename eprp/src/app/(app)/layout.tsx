import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar, TopBar } from "@/components/layout";

/**
 * Application shell: sidebar + top bar around a responsive content area.
 * All product routes live inside this group; standalone pages (e.g.
 * /design-system) stay outside it.
 */
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SidebarProvider>
      <AppSidebar />
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
