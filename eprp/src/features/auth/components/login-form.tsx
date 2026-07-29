"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Eye, EyeOff, Loader2, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
}

export function LoginForm({ next }: LoginFormProps) {
  const [state, formAction] = useActionState<SignInState, FormData>(signIn, {});
  // Hidden by default; this boolean is the only state the toggle keeps.
  const [showPassword, setShowPassword] = React.useState(false);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />

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

      <Field>
        <FieldLabel htmlFor="password">Password</FieldLabel>
        <div className="relative">
          <Input
            id="password"
            name="password"
            /*
              Only the input's `type` changes — the value is never copied,
              stored, or read by the toggle, so nothing here can leak it.
              `name` and `autoComplete` stay fixed so password managers keep
              recognising the field in both states.
            */
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            placeholder="••••••••"
            aria-invalid={state.error ? true : undefined}
            className="pe-9"
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            // The label states the action; aria-pressed states the mode, so
            // screen readers announce both without the label changing meaning.
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            aria-controls="password"
            className="absolute inset-y-0 end-0 flex w-9 items-center justify-center rounded-e-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {showPassword ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </Field>

      <SubmitButton />
    </form>
  );
}
