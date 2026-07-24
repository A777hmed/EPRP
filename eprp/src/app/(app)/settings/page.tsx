import type { Metadata } from "next";
import { Settings } from "lucide-react";

import { PlaceholderPage } from "@/components/shared";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <PlaceholderPage
      eyebrow="System"
      title="Settings"
      description="Platform configuration and personal preferences."
      icon={Settings}
    />
  );
}
