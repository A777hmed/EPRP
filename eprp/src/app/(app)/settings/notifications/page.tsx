import type { Metadata } from "next";
import { NotificationPreferencesView } from "@/features/notifications/notification-preferences";
export const metadata: Metadata = { title: "Notification preferences" };
export default function NotificationSettingsPage() { return <NotificationPreferencesView />; }
