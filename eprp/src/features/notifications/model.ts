export const notificationCategories = {
  tasks: { label: "Tasks", description: "Assigned work, returned submissions and items needing your attention." },
  approvals: { label: "Approvals", description: "Review requests and approval outcomes relevant to you." },
  weekly: { label: "Weekly reporting", description: "Project reporting deadlines and Weekly cycle updates." },
  monthly: { label: "Monthly reporting", description: "Monthly collection, compilation and reporting deadlines." },
  milestones: { label: "Milestones", description: "Approaching dates and overdue milestones relevant to you." },
  information: { label: "Project updates", description: "Published reports and informational project updates." },
} as const;
export type NotificationCategory = keyof typeof notificationCategories;
export interface NotificationTarget {
  type: "weekly" | "monthly" | "milestone" | "calendar";
  id: string;
  projectId: string;
}
export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  title: string;
  description: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  readAt: string | null;
  target: NotificationTarget;
}
export interface NotificationProject { id: string; name: string }
export interface NotificationPreferences {
  categories: Record<NotificationCategory, boolean>;
  followedProjectIds: string[];
}
export interface NotificationOptions {
  // Future backend supplies only permitted projects/categories. This is not a grant.
  projects: NotificationProject[];
  categories: NotificationCategory[];
  canFollowProjects: boolean;
}
export interface NotificationOverview {
  unreadCount: number;
  options: NotificationOptions;
  preferences: NotificationPreferences;
}
export interface NotificationQuery {
  projectId: string;
  category: NotificationCategory | "all";
  read: "all" | "unread" | "read";
  page: number;
  pageSize: number;
}
export interface NotificationPage { items: NotificationItem[]; total: number; page: number; pageCount: number }
export interface NotificationService {
  readonly mode: "disconnected" | "development";
  getOverview(): Promise<NotificationOverview>;
  list(query: NotificationQuery): Promise<NotificationPage>;
  setRead(id: string, read: boolean): Promise<void>;
  markAllRead(cutoff: string): Promise<void>;
  savePreferences(preferences: NotificationPreferences): Promise<NotificationPreferences>;
}
export const defaultQuery: NotificationQuery = { projectId: "all", category: "all", read: "all", page: 1, pageSize: 10 };
export function defaultPreferences(): NotificationPreferences {
  return { categories: { tasks: true, approvals: true, weekly: true, monthly: true, milestones: true, information: true }, followedProjectIds: [] };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function notificationHref(target: NotificationTarget): string | null {
  if (!uuid.test(target.id) || !uuid.test(target.projectId)) return null;
  switch (target.type) {
    case "weekly": return `/projects/${target.projectId}/reports/weekly/${target.id}`;
    case "monthly": return `/projects/${target.projectId}/reports/monthly/${target.id}`;
    case "milestone": return `/projects/${target.projectId}/milestones`;
    case "calendar": return `/calendar?event=${target.id}`;
    default: return null;
  }
}
export function groupNotifications(items: NotificationItem[], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const groups: { label: string; items: NotificationItem[] }[] = [];
  for (const item of items) {
    const date = new Date(item.createdAt);
    const label = date >= today ? "Today" : date >= yesterday ? "Yesterday" : "Earlier";
    const group = groups.find((entry) => entry.label === label);
    if (group) group.items.push(item); else groups.push({ label, items: [item] });
  }
  return groups;
}
/** Session-only adapter. No storage, network requests, credentials or authorization claims. */
export function createNotificationAdapter(mode: NotificationService["mode"] = "disconnected", initial: NotificationItem[] = [], options: NotificationOptions = { projects: [], categories: Object.keys(notificationCategories) as NotificationCategory[], canFollowProjects: false }): NotificationService {
  let items = structuredClone(mode === "development" ? initial : []);
  const allowed = structuredClone(mode === "development" ? options : { ...options, projects: [], canFollowProjects: false });
  let preferences = defaultPreferences();
  const pause = async () => { await new Promise<void>((resolve) => setTimeout(resolve, 120)); };
  const ensureDevelopment = () => { if (mode !== "development") throw new Error("Notification delivery is not connected yet."); };
  return {
    mode,
    async getOverview() { await pause(); return structuredClone({ unreadCount: items.filter((item) => !item.readAt).length, options: allowed, preferences }); },
    async list(query) {
      await pause();
      const filtered = items.filter((item) => (query.projectId === "all" || item.projectId === query.projectId) && (query.category === "all" || item.category === query.category) && (query.read === "all" || (query.read === "unread" ? !item.readAt : Boolean(item.readAt)))).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
      const pageSize = Math.max(1, Math.min(50, Math.floor(query.pageSize) || 10));
      const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
      const page = Math.min(pageCount, Math.max(1, Math.floor(query.page) || 1));
      return structuredClone({ items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageCount });
    },
    async setRead(id, read) {
      ensureDevelopment(); await pause();
      if (!items.some((item) => item.id === id)) throw new Error("This notification is no longer available. Refresh and try again.");
      items = items.map((item) => item.id === id ? { ...item, readAt: read ? item.readAt ?? new Date().toISOString() : null } : item);
    },
    async markAllRead(cutoff) {
      ensureDevelopment(); await pause();
      const stamp = new Date().toISOString();
      items = items.map((item) => !item.readAt && item.createdAt <= cutoff ? { ...item, readAt: stamp } : item);
    },
    async savePreferences(next) {
      await pause();
      const known = new Set(allowed.projects.map((project) => project.id));
      if (next.followedProjectIds.some((id) => !known.has(id)) || (!allowed.canFollowProjects && next.followedProjectIds.length)) throw new Error("Refresh permitted projects before changing subscriptions.");
      if (Object.keys(next.categories).some((key) => !(key in notificationCategories))) throw new Error("Unknown notification category.");
      preferences = structuredClone(next);
      return structuredClone(preferences);
    },
  };
}
export function developmentNotifications(now = new Date()): { items: NotificationItem[]; options: NotificationOptions } {
  const projects = [{ id: "11111111-1111-4111-8111-111111111111", name: "Sample · Refinery reliability" }, { id: "22222222-2222-4222-8222-222222222222", name: "Sample · Utilities improvement" }];
  const categories = Object.keys(notificationCategories) as NotificationCategory[];
  const titles = ["Weekly submission ready for review", "A milestone is approaching", "Monthly report published", "A submission was returned", "Weekly reporting deadline approaching", "Project update available", "Monthly collection awaiting review", "Milestone update approved", "Reporting task assigned", "Published report available", "Monthly reporting deadline approaching", "Weekly report finalized"];
  const items = titles.map((title, index): NotificationItem => {
    const project = projects[index % projects.length];
    const category: NotificationCategory = (["approvals", "milestones", "information", "tasks", "weekly", "information", "approvals", "information", "tasks", "information", "monthly", "information"] as const)[index];
    return { id: `sample-${index}`, category, title, description: "Sample notification for development preview. No actual task, deadline or permission is represented.", projectId: project.id, projectName: project.name, createdAt: new Date(now.getTime() - index * 8 * 3600000).toISOString(), readAt: index > 8 ? now.toISOString() : null, target: { type: index === 1 || index === 7 ? "milestone" : index === 2 || index === 6 || index === 10 ? "monthly" : "weekly", id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`, projectId: project.id } };
  });
  return { items, options: { projects, categories, canFollowProjects: true } };
}
