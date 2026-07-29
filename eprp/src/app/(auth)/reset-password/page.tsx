import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

import { AuthShell } from "@/features/auth/components/auth-shell";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import { getAuthenticatedUser } from "@/features/auth/session";

export const metadata: Metadata = {
  title: "Set New Password",
  description: "Choose a new password for your EPRP account.",
};

/**
 * Reached only from a Supabase recovery email, via /auth/confirm — which
 * exchanges the token for a session before redirecting here.
 *
 * The form is shown only when that session exists, so opening this URL
 * directly cannot be used to change anyone's password. `resetPassword`
 * re-checks the session server-side; this is the visible half of the gate.
 */
export default async function ResetPasswordPage() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return (
      <AuthShell
        title="Reset link not valid"
        description="This link is invalid, has already been used, or has expired."
        footer={
          <Link
            href="/forgot-password"
            className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-sm"
          >
            Request a new reset link
          </Link>
        }
      >
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <AlertCircle
            className="mt-0.5 size-4 shrink-0 text-warning"
            aria-hidden="true"
          />
          <p className="text-sm text-pretty">
            Password reset links can only be used once and expire after a short
            time. Request a fresh link to continue.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Set a new password"
      description={`Choose a new password for ${user.email}.`}
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
