"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { PasswordInput } from "./password-input";
import { PasswordRulesHint } from "./password-rules-hint";
import { resetPassword, type PasswordFormState } from "../password-actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" size="lg" disabled={pending}>
      {pending ? (
        <Loader2
          data-icon="inline-start"
          className="animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : (
        <KeyRound data-icon="inline-start" aria-hidden="true" />
      )}
      {pending ? "Updating…" : "Set New Password"}
    </Button>
  );
}

export function ResetPasswordForm() {
  const [state, formAction] = useActionState<PasswordFormState, FormData>(
    resetPassword,
    {}
  );
  // Drives the live rule checklist only; never sent anywhere itself.
  const [password, setPassword] = React.useState("");

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error && (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
        >
          <AlertCircle
            className="mt-0.5 size-4 shrink-0 text-destructive"
            aria-hidden="true"
          />
          <p className="text-sm text-destructive text-pretty">{state.error}</p>
        </div>
      )}

      <Field>
        <FieldLabel htmlFor="password">New password</FieldLabel>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={state.error ? true : undefined}
        />
        <PasswordRulesHint value={password} />
      </Field>

      <Field>
        <FieldLabel htmlFor="confirmPassword">Confirm new password</FieldLabel>
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          autoComplete="new-password"
          required
          aria-invalid={state.error ? true : undefined}
        />
      </Field>

      <SubmitButton />
    </form>
  );
}
