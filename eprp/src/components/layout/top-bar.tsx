import { Suspense } from "react";
import { Bell, ChevronDown, Mail, Search } from "lucide-react";

import { SignOutMenuItem } from "@/features/auth/components/sign-out-menu-item";
import { getCurrentUserIdentity } from "@/features/auth/profile";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ThemeToggle } from "@/components/layout/theme-toggle";

async function AuthenticatedUserMenu() {
  const identity = await getCurrentUserIdentity();
  const name = identity?.fullName.trim() || "Signed-in user";
  const role = identity?.roleLabel?.trim() || "No role assigned";
  const initials = identity?.initials.trim() || "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 gap-2 rounded-full px-1.5 lg:rounded-lg lg:pr-2"
          aria-label="Open user menu"
        >
          <Avatar className="size-7">
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-left leading-tight lg:grid">
            <span className="text-sm font-medium">{name}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {role}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className="hidden size-3.5 text-muted-foreground lg:block"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>
          <div className="grid leading-tight">
            <span className="font-medium">{name}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {role}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Profile</DropdownMenuItem>
        <DropdownMenuItem>Preferences</DropdownMenuItem>
        <DropdownMenuSeparator />
        <SignOutMenuItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AuthenticatedUserMenuSkeleton() {
  return (
    <div
      className="flex h-9 items-center gap-2 rounded-full px-1.5 lg:rounded-lg lg:pr-2"
      aria-label="Loading user profile"
      role="status"
    >
      <Skeleton className="size-7 shrink-0 rounded-full" />
      <span className="hidden w-24 space-y-1.5 lg:block">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3 w-16" />
      </span>
    </div>
  );
}

/**
 * Global top bar: sidebar toggle, breadcrumbs, and the global action
 * cluster (search, notifications, profile). Search and notifications are
 * placeholders wired up in later phases.
 */
export function TopBar() {
  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mr-1 h-4!" />
      <Breadcrumbs />

      <div className="ml-auto flex items-center gap-1.5">
        <Button
          variant="outline"
          className="hidden w-56 justify-start text-muted-foreground select-none sm:inline-flex"
          aria-label="Open global search"
        >
          <Search aria-hidden="true" />
          <span className="flex-1 text-left font-normal">Search…</span>
          <kbd className="pointer-events-none rounded-sm border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground">
            Ctrl K
          </kbd>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="sm:hidden"
          aria-label="Open global search"
        >
          <Search aria-hidden="true" />
        </Button>

        <ThemeToggle />

        <Button variant="ghost" size="icon" aria-label="Messages">
          <Mail aria-hidden="true" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Notifications"
        >
          <Bell aria-hidden="true" />
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-destructive"
          />
        </Button>

        <Suspense fallback={<AuthenticatedUserMenuSkeleton />}>
          <AuthenticatedUserMenu />
        </Suspense>
      </div>
    </header>
  );
}
