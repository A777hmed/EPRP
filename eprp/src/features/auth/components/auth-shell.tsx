import Image from "next/image";
import { ShieldCheck } from "lucide-react";

import { siteConfig } from "@/config/site";

export interface AuthShellProps {
  title: string;
  description: string;
  children: React.ReactNode;
  /** Rendered under the card, e.g. a link back to sign-in. */
  footer?: React.ReactNode;
}

/**
 * Full-screen EPROM-branded frame shared by the sign-in, forgot-password and
 * reset-password pages, so every auth screen keeps the same premium layout,
 * spacing and responsive behaviour.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: AuthShellProps) {
  return (
    <main className="flex min-h-svh flex-col bg-muted/30">
      <div className="flex flex-1 items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="w-full max-w-sm">
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
              {title}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
              {description}
            </p>
          </div>

          {/* motion-safe only: reduced motion removes the entrance entirely. */}
          <div className="rounded-xl border bg-card p-5 shadow-soft motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 sm:p-6">
            {children}
          </div>

          {footer && <div className="mt-5 text-center text-sm">{footer}</div>}

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
