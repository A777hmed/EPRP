"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  contactService,
  departmentService,
  jobTitleService,
} from "@/features/master-data";
import { FIXED_RESPONSIBILITIES } from "@/features/projects/responsibilities";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ProfileRow } from "@/lib/supabase/database.types";
import { projectService } from "@/services/project-service";
import type {
  Contact,
  Department,
  JobTitle,
  Project,
  UserProfile,
  UserRole,
} from "@/types";
import type { UserAssignmentEntry, UserRow } from "./types";

/**
 * Loosely-typed client for `profiles` reads/writes.
 *
 * Matches the cast already used for mutations elsewhere (e.g.
 * `supabase-project-service.ts`): the generated `Database` type resolves
 * `.select()`/`.insert()`/`.update()` results to `never` for tables reached
 * this way, so results are cast against `ProfileRow` instead of relying on
 * inference.
 */
function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

/** Reads the `profiles` table directly — no dedicated service exists yet. */
export async function fetchProfiles(): Promise<UserProfile[]> {
  const { data, error } = await client()
    .from("profiles")
    .select(
      "id, email, full_name, role, contact_id, active, created_at, updated_at"
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ProfileRow[];

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role as UserRole,
    contactId: row.contact_id ?? undefined,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/** `project_contacts.assignment_role` labels — the project-team half of
 * Project Responsibility, distinct from the five fixed roles below. */
const ASSIGNMENT_ROLE_LABELS: Record<string, string> = {
  department_manager: "Department Manager",
  team_member_lead: "Team Member Lead",
  team_member: "Team Member",
};

/**
 * A person's project assignments, flattened from the three places they can
 * live: the five fixed responsibility columns on `projects`, the project
 * team (`project_contacts.assignment_role` + `department_id`), and any
 * additional named positions (`project_positions`).
 */
function assignmentsForContact(
  contactId: string,
  projects: Project[],
  departmentsById: Map<string, Department>,
  jobTitlesById: Map<string, JobTitle>
): UserAssignmentEntry[] {
  const rows: UserAssignmentEntry[] = [];

  for (const project of projects) {
    const projectName = project.shortName ?? project.name;

    for (const meta of FIXED_RESPONSIBILITIES) {
      if (project[meta.field] === contactId) {
        rows.push({
          projectId: project.id,
          projectName,
          responsibility: meta.label,
          departmentName: null,
        });
      }
    }

    for (const member of project.team ?? []) {
      if (member.contactId !== contactId) continue;
      const responsibility = member.assignmentRole
        ? (ASSIGNMENT_ROLE_LABELS[member.assignmentRole] ?? member.assignmentRole)
        : "Team Member";
      rows.push({
        projectId: project.id,
        projectName,
        responsibility,
        departmentName: member.departmentId
          ? (departmentsById.get(member.departmentId)?.name ?? null)
          : null,
      });
    }

    for (const position of project.positions ?? []) {
      if (position.contactId !== contactId) continue;
      rows.push({
        projectId: project.id,
        projectName,
        responsibility:
          jobTitlesById.get(position.jobTitleId)?.name ?? "Additional Position",
        departmentName: null,
      });
    }
  }

  return rows;
}

export interface AdminUsersData {
  rows: UserRow[];
  projects: Project[];
  contacts: Contact[];
}

/** Everything the Users & Roles screen needs, joined client-side from
 * existing tables and services — no new query surface on the database. */
export async function fetchAdminUsersData(): Promise<AdminUsersData> {
  const [profiles, contacts, departments, jobTitles, projects] =
    await Promise.all([
      fetchProfiles(),
      contactService.getAll(),
      departmentService.getAll(),
      jobTitleService.getAll(),
      projectService.getProjects(),
    ]);

  const contactsById = new Map(contacts.map((c) => [c.id, c]));
  const departmentsById = new Map(departments.map((d) => [d.id, d]));
  const jobTitlesById = new Map(jobTitles.map((j) => [j.id, j]));

  const rows: UserRow[] = profiles.map((profile) => {
    const contact = profile.contactId
      ? contactsById.get(profile.contactId)
      : undefined;

    return {
      profileId: profile.id,
      loginEmail: profile.email,
      fullName: profile.fullName,
      role: profile.role,
      active: profile.active,
      createdAt: profile.createdAt,
      contactId: profile.contactId ?? null,
      personName: contact?.name ?? null,
      jobTitle:
        (contact?.jobTitleId ? jobTitlesById.get(contact.jobTitleId)?.name : undefined) ??
        contact?.position?.trim() ??
        null,
      workEmail: contact?.email ?? null,
      assignments: contact
        ? assignmentsForContact(contact.id, projects, departmentsById, jobTitlesById)
        : [],
    };
  });

  return { rows, projects, contacts };
}
