import type { Weekday } from "@/types";

/** Static select options for the project form (Phase 5A). */

export const weekdayOptions: { value: Weekday; label: string }[] = [
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
];

export const currencyOptions = ["EGP", "USD", "EUR", "SAR", "AED"] as const;

export const workingWeekOptions = [
  "Sun – Thu",
  "Sat – Thu",
  "Mon – Fri",
  "Sat – Wed",
] as const;

export const timeZoneOptions = [
  "Africa/Cairo",
  "Europe/Athens",
  "Asia/Riyadh",
  "Asia/Dubai",
  "UTC",
] as const;

export const languageOptions = [
  { value: "en", label: "English" },
  { value: "ar", label: "Arabic" },
] as const;

export type ProjectSortKey =
  | "updated"
  | "name"
  | "code"
  | "progress"
  | "variance";

export const projectSortOptions: { value: ProjectSortKey; label: string }[] = [
  { value: "updated", label: "Last updated" },
  { value: "name", label: "Name (A–Z)" },
  { value: "code", label: "Code (A–Z)" },
  { value: "progress", label: "Actual progress" },
  { value: "variance", label: "Schedule variance" },
];
