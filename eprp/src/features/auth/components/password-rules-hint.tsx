"use client";

import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { PASSWORD_RULES } from "../password";

export interface PasswordRulesHintProps {
  /** The new-password value being typed. */
  value: string;
}

/**
 * Live checklist for the password rules.
 *
 * Purely advisory — the same rules run again in the server action, which is
 * the check that actually decides.
 */
export function PasswordRulesHint({ value }: PasswordRulesHintProps) {
  return (
    <ul className="mt-1.5 grid gap-1" aria-live="polite">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(value);
        return (
          <li
            key={rule.id}
            className={cn(
              "flex items-center gap-1.5 text-xs",
              met ? "text-success" : "text-muted-foreground"
            )}
          >
            {met ? (
              <Check className="size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <X className="size-3.5 shrink-0 opacity-50" aria-hidden="true" />
            )}
            <span>{rule.label}</span>
            <span className="sr-only">{met ? " — met" : " — not met"}</span>
          </li>
        );
      })}
    </ul>
  );
}
