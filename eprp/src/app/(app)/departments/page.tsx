import type { Metadata } from "next";

import { DepartmentsListView } from "@/features/master-data";

export const metadata: Metadata = {
  title: "Departments",
};

export default function DepartmentsPage() {
  return <DepartmentsListView />;
}
