import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/shared";
import { getCurrentUserIdentity } from "@/features/auth/profile";
import { UsersRolesView } from "@/features/admin-users";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "Users & Roles",
};

/**
 * Administration → Users & Roles. Gated to a System Administrator here as
 * well as by RLS on `profiles` — the nav item is already hidden from
 * everyone else (`requiresGlobalAuthority`), but a direct link should not
 * expose even the page shell to an unauthorized account.
 */
export default async function UsersRolesPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="System"
          title="Users & Roles"
          description="Link platform accounts to people and set access."
        />
        <EmptyState
          icon={ShieldAlert}
          title="Account service is not configured"
          description="Users & Roles requires the platform account service to be available."
        />
      </div>
    );
  }

  const identity = await getCurrentUserIdentity();
  if (identity?.role !== "system_admin") {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="System"
          title="Users & Roles"
          description="Link platform accounts to people and set access."
        />
        <EmptyState
          icon={ShieldAlert}
          title="System Administrator access required"
          description="Only a System Administrator can view and manage platform accounts."
        />
      </div>
    );
  }

  return <UsersRolesView />;
}
