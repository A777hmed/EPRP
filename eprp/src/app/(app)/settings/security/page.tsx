import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader, SectionCard } from "@/components/shared";
import { ChangePasswordForm } from "@/features/auth/components/change-password-form";
import { getAuthenticatedUser } from "@/features/auth/session";

export const metadata: Metadata = {
  title: "Security",
  description: "Manage your EPRP account password.",
};

/**
 * Authenticated-only. The proxy already redirects signed-out visitors, but
 * this checks again server-side: proxy gating is a convenience, not the
 * authorization boundary.
 */
export default async function SecuritySettingsPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?next=%2Fsettings%2Fsecurity");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Security"
        description="Update the password for your own account."
      />

      <SectionCard
        title="Change password"
        description={`Signed in as ${user.email}. Your current password is required to make a change.`}
      >
        <ChangePasswordForm />
      </SectionCard>
    </div>
  );
}
