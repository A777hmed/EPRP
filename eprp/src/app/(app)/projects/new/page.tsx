import type { Metadata } from "next";

import { ProjectSetupView } from "@/features/projects";

export const metadata: Metadata = {
  title: "New Project",
};

/** Step 1 of the setup wizard — creates the project, then hands off its id. */
export default function NewProjectPage() {
  return <ProjectSetupView step="info" />;
}
