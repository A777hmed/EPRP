"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";

export interface PasswordInputProps
  extends Omit<React.ComponentProps<typeof Input>, "type"> {
  id: string;
}

/**
 * Password field with an accessible show/hide toggle.
 *
 * Only the input's `type` changes — the value is never read, copied, or
 * stored by the toggle. `name` and `autoComplete` stay fixed in both states
 * and the input is never remounted, so password managers keep tracking the
 * same field.
 */
export function PasswordInput({ id, className, ...props }: PasswordInputProps) {
  const [shown, setShown] = React.useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        id={id}
        type={shown ? "text" : "password"}
        className={className ? `pe-9 ${className}` : "pe-9"}
      />
      <button
        type="button"
        onClick={() => setShown((value) => !value)}
        // The label names the action; aria-pressed carries the state, so the
        // control is announced as a toggle without the label changing meaning.
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        aria-controls={id}
        className="absolute inset-y-0 end-0 flex w-9 items-center justify-center rounded-e-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {shown ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
