"use client";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { signOut } from "../actions";

/**
 * "Sign out" entry for the top-bar user menu.
 *
 * A server action cannot be called directly from an `onClick` without a
 * transition, so it is submitted as a form action instead — which also keeps
 * it working with JavaScript disabled.
 */
export function SignOutMenuItem() {
  return (
    <form action={signOut}>
      <DropdownMenuItem variant="destructive" asChild>
        <button type="submit" className="w-full cursor-default text-left">
          Sign out
        </button>
      </DropdownMenuItem>
    </form>
  );
}
