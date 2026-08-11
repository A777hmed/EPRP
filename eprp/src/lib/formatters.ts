import { format, parseISO } from "date-fns";

/**
 * Format an ISO date string for display, e.g. "17 Jul 2026".
 * Empty or invalid values (e.g. unset dates on draft projects) render "—".
 */
export function formatDate(isoDate: string | undefined | null): string {
  if (!isoDate) return "—";
  const date = parseISO(isoDate);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "dd MMM yyyy");
}

/** Format an ISO timestamp with local date and 24-hour time. */
export function formatDateTime(isoDate: string | undefined | null): string {
  if (!isoDate) return "â€”";
  const date = parseISO(isoDate);
  if (Number.isNaN(date.getTime())) return "â€”";
  return format(date, "dd MMM yyyy, HH:mm");
}

/** Format a number as a compact currency value, e.g. "$1.2M". */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** Format a 0-100 value as a percentage string, e.g. "68%". */
export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

/** Format a number with thousands separators, e.g. "12,480". */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
