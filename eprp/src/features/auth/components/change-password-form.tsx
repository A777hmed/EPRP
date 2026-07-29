"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { PasswordInput } from "./password-input";
import { PasswordRulesHint } from "./password-rules-hint";
import { changePassword, type PasswordFormState } from "../password-actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <Loader2
          data-icon="inline-start"
          className="animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : (
        <KeyRound data-icon="inline-start" aria-hidden="true" />
      )}
      {pending ? "Updating…" : "Update Password"}
    </Button>
  );
}

/**
 * The three password fields.
 *
 * Kept as its own component so the parent can clear everything by changing
 * its `key` after a successful change — remounting drops both the DOM values
 * and the local state, without a setState-inside-effect.
 */
function PasswordFields({ invalid }: { invalid: boolean }) {
  const [password, setPassword] = React.useState("");

  return (
    <>
      <Field>
        <FieldLabel htmlFor="currentPassword">Current password</FieldLabel>
        <PasswordInput
          id="currentPassword"
          name="currentPassword"
          autoComplete="current-password"
          required
          aria-invalid={invalid ? true : undefined}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="password">New password</FieldLabel>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={invalid ? true : undefined}
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
          aria-invalid={invalid ? true : undefined}
        />
      </Field>
    </>
  );
}

export function ChangePasswordForm() {
  const [state, formAction] = useActionState<PasswordFormState, FormData>(
    changePassword,
    {}
  );

  return (
    <div className="max-w-md space-y-4">
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

      {state.success && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/5 p-3"
        >
          <CheckCircle2
            className="mt-0.5 size-4 shrink-0 text-success"
            aria-hidden="true"
          />
          <p className="text-sm text-success text-pretty">{state.success}</p>
        </div>
      )}

      <form action={formAction} className="space-y-4" noValidate>
        {/* Remounts on success, which clears every field. */}
        <PasswordFields
          key={state.success ? "cleared" : "editing"}
          invalid={Boolean(state.error)}
        />
        <div>
          <SubmitButton />
        </div>
      </form>
    </div>
  );
}
