import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";

import { PlaceholderPage } from "@/components/shared";

export const metadata: Metadata = {
  title: "Administration",
};

export default function AdministrationPage() {
  return (
    <PlaceholderPage
      eyebrow="System"
      title="Administration"
      description="Departments, users, roles, and reporting periods."
      icon={ShieldCheck}
    />
  );
}
