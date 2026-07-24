/** Mock recent-activity entries shown on project detail pages (Phase 5A). */

export interface ProjectActivityEntry {
  id: string;
  text: string;
  actor: string;
  at: string; // ISO datetime
}

export const mockProjectActivity: ProjectActivityEntry[] = [
  {
    id: "act-1",
    text: "Weekly report W28 approved",
    actor: "Khaled Fahmy",
    at: "2026-07-14T10:30:00Z",
  },
  {
    id: "act-2",
    text: "Actual progress updated to reflect week 28 submissions",
    actor: "Nour Adel",
    at: "2026-07-13T15:05:00Z",
  },
  {
    id: "act-3",
    text: "New risk raised: material delivery delay",
    actor: "Mohamed Helmy",
    at: "2026-07-12T08:45:00Z",
  },
  {
    id: "act-4",
    text: "Monthly report June 2026 finalized",
    actor: "Ahmed Morsy",
    at: "2026-07-02T12:00:00Z",
  },
];
