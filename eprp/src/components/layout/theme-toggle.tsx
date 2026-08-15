"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/**
 * Light / Dark / System switch for the top bar.
 *
 * The trigger icon is swapped by CSS, not by state. The server cannot know the
 * stored preference, so deriving the icon from `resolvedTheme` on the first
 * client render would hydrate-mismatch — and gating it behind a `mounted` flag
 * means calling setState from an effect, which the React Compiler lint
 * (`react-hooks/set-state-in-effect`) rejects. Rendering BOTH icons and letting
 * the `dark:` variant reveal one keeps the markup identical on both sides and
 * needs no state at all.
 *
 * The menu items may read `theme` freely: Radix mounts the content in a portal
 * only once opened, which is always after hydration.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change colour theme">
          <Sun aria-hidden="true" className="dark:hidden" />
          <Moon aria-hidden="true" className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setTheme(option.value)}
            data-active={theme === option.value ? "true" : undefined}
            className="gap-2 data-[active=true]:font-semibold data-[active=true]:text-primary"
          >
            <option.icon aria-hidden="true" className="size-4" />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
