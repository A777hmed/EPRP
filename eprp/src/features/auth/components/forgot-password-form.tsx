"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  requestPasswordReset,
  type PasswordFormState,
} from "../password-actions";

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
        <Mail data-icon="inline-start" aria-hidden="true" />
      )}
      {pending ? "Sending…" : "Send Reset Link"}
    </Button>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<PasswordFormState, FormData>(
    requestPasswordReset,
    {}
  );

  // The reply is identical whether or not the address exists, so the form is
  // replaced entirely rather than left open for probing.
  if (state.success) {
    return (
      <div className="space-y-3">
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
        <p className="text-xs text-muted-foreground text-pretty">
          The link expires after a short time. If it does not arrive, ask the
          System Administrator to confirm your account email.
        </p>
      </div>
    );
  }

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
        <FieldLabel htmlFor="email">Email address</FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          placeholder="name@eprom.com.eg"
          aria-invalid={state.error ? true : undefined}
        />
      </Field>

      <SubmitButton />
    </form>
  );
}
