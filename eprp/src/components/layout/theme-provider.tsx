"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type * as React from "react";

/**
 * Application theme provider.
 *
 * `next-themes` was already a dependency — `components/ui/sonner.tsx` calls
 * `useTheme()` — but no provider was ever mounted, so the toast surface read a
 * permanent "system" and the `.dark` class was never applied to any route.
 * Mounting it here is what makes the dark palette in `globals.css` reachable.
 *
 * `attribute="class"` matches the `@custom-variant dark (&:is(.dark *))` rule
 * that every `dark:` utility in the app compiles against. The preference is
 * persisted to localStorage by the library under `epr-theme`, and
 * `disableTransitionOnChange` stops every tokenised surface from animating at
 * once while the palette swaps.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="epr-theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
