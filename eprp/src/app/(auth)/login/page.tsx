import type { Metadata } from "next";
import Image from "next/image";
import { ShieldCheck } from "lucide-react";

import { siteConfig } from "@/config/site";
import { LoginForm } from "@/features/auth/components/login-form";

export const metadata: Metadata = {
  title: "Sign In",
  description: `Sign in to ${siteConfig.fullName}.`,
};

/** Only same-origin relative paths survive; see `safeNextPath` in the action. */
function readNext(value: string | string[] | undefined): string {
  if (typeof value !== "string") return "/dashboard";
  if (!/^\/(?!\/)/.test(value)) return "/dashboard";
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  // Next 16: searchParams is async.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = readNext(params.next);

  return (
    <main className="flex min-h-svh flex-col bg-muted/30">
      <div className="flex flex-1 items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="w-full max-w-sm">
          {/* Brand lockup */}
          <div className="mb-6 flex flex-col items-center text-center">
            <Image
              src={siteConfig.logo.full}
              alt={siteConfig.company}
              width={siteConfig.logo.fullWidth}
              height={siteConfig.logo.fullHeight}
              priority
              className="h-12 w-auto"
            />
            <h1 className="mt-5 text-xl font-semibold tracking-tight text-balance">
              {siteConfig.fullName}
              <span className="ml-1.5 text-muted-foreground">
                ({siteConfig.name})
              </span>
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
              Sign in to continue to the internal reporting platform.
            </p>
          </div>

          {/*
            motion-safe only, so the reduced-motion preference removes it
            entirely rather than merely shortening it.
          */}
          <div className="rounded-xl border bg-card p-5 shadow-soft motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 sm:p-6">
            <LoginForm next={next} />
          </div>

          <p className="mt-5 flex items-start justify-center gap-1.5 text-center text-xs text-muted-foreground text-pretty">
            <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Internal EPROM system. Accounts are issued by the System
              Administrator — there is no public registration.
            </span>
          </p>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            © {new Date().getFullYear()} {siteConfig.company}
          </p>
        </div>
      </div>
    </main>
  );
}
