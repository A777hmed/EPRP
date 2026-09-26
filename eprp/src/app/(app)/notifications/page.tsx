import type { Metadata } from "next";
import { NotificationHistory } from "@/features/notifications/notification-center";
export const metadata: Metadata = { title: "Notifications" };
export default function NotificationsPage() { return <NotificationHistory />; }
