import { redirect } from "next/navigation";

/** The dashboard is the platform home — keep "/" pointing at it. */
export default function RootPage() {
  redirect("/dashboard");
}
