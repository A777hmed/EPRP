import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bell } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
export const metadata: Metadata = { title: "Settings" };
export default function SettingsPage() {
  return <div className="space-y-6"><PageHeader eyebrow="System" title="Settings" description="Platform configuration and personal preferences." /><Link href="/settings/notifications" className="flex max-w-2xl items-center gap-4 rounded-xl border bg-card p-5 transition-colors hover:bg-muted/40 focus-visible:outline-ring"><span className="rounded-lg bg-primary/10 p-3 text-primary"><Bell className="size-5" /></span><span className="flex-1"><span className="block text-sm font-semibold">Notification preferences</span><span className="mt-1 block text-sm text-muted-foreground">Choose categories and informational project subscriptions.</span></span><ArrowRight className="size-4 text-muted-foreground" /></Link></div>;
}
