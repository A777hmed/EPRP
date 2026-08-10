"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Loader2, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "./password-input";
import { signIn, type SignInState } from "../actions";

/**
 * Submit button with the form's own pending state. `useFormStatus` must be
 * read from a child of the form, which is why this is a separate component.
 */
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
        <LogIn data-icon="inline-start" aria-hidden="true" />
      )}
      {pending ? "Signing in…" : "Sign In"}
    </Button>
  );
}

export interface LoginFormProps {
  /** Path to return to after a successful sign-in. */
  next: string;
  /** One-off notice from a redirect, e.g. after a password reset. */
  notice?: { tone: "success" | "error"; message: string };
}

export function LoginForm({ next, notice }: LoginFormProps) {
  const [state, formAction] = useActionState<SignInState, FormData>(signIn, {});

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />

      {notice && !state.error && (
        <div
          role="status"
          className={
            notice.tone === "success"
              ? "flex items-start gap-2 rounded-lg border border-success/30 bg-success/5 p-3"
              : "flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
          }
        >
          {notice.tone === "success" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          )}
          <p
            className={
              notice.tone === "success"
                ? "text-sm text-success text-pretty"
                : "text-sm text-destructive text-pretty"
            }
          >
            {notice.message}
          </p>
        </div>
      )}

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
          placeholder="you@example.com"
          aria-invalid={state.error ? true : undefined}
        />
      </Field>

      <Field>
        <div className="flex items-baseline justify-between gap-2">
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-sm"
          >
            Forgot password?
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          aria-invalid={state.error ? true : undefined}
        />
      </Field>

      <SubmitButton />
    </form>
  );
}
