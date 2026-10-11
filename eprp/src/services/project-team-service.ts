import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  memberDraftIssues,
  PROJECT_ROLE_MAX,
  wouldCreateCycle,
} from "@/features/projects/project-team";
import type { Project, ProjectMember } from "@/types";
import { mapProjectTeamError, ProjectTeamError } from "./project-team-errors";

/**
 * Project Team Membership (Phase 2C.3C) — the one contract the team UI uses.
 *
 * Writes are immediate and one membership at a time, like Project Structure:
 * each runs against the project's own version (the same token every Project
 * Setup save uses), so a stale page is refused instead of overwriting, and
 * every membership write makes older setup pages stale in turn.
 *
 * Membership is AUTHORITY-FREE. Who may write is decided by the database
 * (System Admin / Project Control Admin, or the project's own assigned
 * Project Control / Planning); nothing here grants or checks access.
 */
export interface AddMemberInput {
  projectId: string;
  /** The project version this page loaded (`project.updatedAt`). */
  version: string;
  contactId: string;
  partyId: string;
  projectRole: string;
  reportsToMemberId?: string;
}

export interface UpdateMemberInput {
  projectId: string;
  version: string;
  memberId: string;
  /** Party and Project Role are always saved together: a legacy member is completed here. */
  partyId: string;
  projectRole: string;
  reportsToMemberId?: string;
}

export interface EndMemberInput {
  projectId: string;
  version: string;
  memberId: string;
}

export interface MemberWriteResult {
  memberId: string;
  /** The project's new version after this write. */
  version: string;
}

export interface ProjectTeamService {
  addMember(input: AddMemberInput): Promise<MemberWriteResult>;
  updateMember(input: UpdateMemberInput): Promise<MemberWriteResult>;
  /** Ending needs no Party / Project Role, so an incomplete legacy membership can be ended. */
  endMember(input: EndMemberInput): Promise<MemberWriteResult>;
}

/** Refuse an incomplete add / edit before anything is sent. */
function assertDraft(input: { contactId?: string; partyId?: string; projectRole?: string }, requirePerson: boolean) {
  const issues = memberDraftIssues(input, { requirePerson });
  if (issues.contactId) throw new ProjectTeamError("person_required");
  if (issues.partyId) throw new ProjectTeamError("party_required");
  if (issues.projectRole) throw new ProjectTeamError("project_role_required");
}

function writeResult(data: unknown): MemberWriteResult {
  const value = data as { member_id?: string; version?: string } | null;
  if (!value?.member_id || !value.version) throw new ProjectTeamError("failed");
  return { memberId: value.member_id, version: value.version };
}

/* -------------------------------- Supabase -------------------------------- */

export type TeamClient = Pick<SupabaseClient, "rpc">;

export function createSupabaseProjectTeamService(client: () => TeamClient): ProjectTeamService {
  return {
    async addMember(input) {
      assertDraft(input, true);
      const { data, error } = await client().rpc("add_project_member", {
        p_project: input.projectId,
        p_expected_updated_at: input.version,
        p_contact: input.contactId,
        p_party: input.partyId,
        p_project_role: input.projectRole.trim(),
        p_reports_to: input.reportsToMemberId ?? null,
      });
      if (error) throw mapProjectTeamError(error);
      return writeResult(data);
    },
    async updateMember(input) {
      assertDraft(input, false);
      const { data, error } = await client().rpc("update_project_member", {
        p_project: input.projectId,
        p_expected_updated_at: input.version,
        p_member: input.memberId,
        p_party: input.partyId,
        p_project_role: input.projectRole.trim(),
        p_reports_to: input.reportsToMemberId ?? null,
      });
      if (error) throw mapProjectTeamError(error);
      return writeResult(data);
    },
    async endMember(input) {
      const { data, error } = await client().rpc("end_project_member", {
        p_project: input.projectId,
        p_expected_updated_at: input.version,
        p_member: input.memberId,
      });
      if (error) throw mapProjectTeamError(error);
      return writeResult(data);
    },
  };
}

/* ------------------------------ in-memory mock ----------------------------- */

/** The project store the mock shares with Project Setup (one version per project). */
export interface TeamProjectStore {
  read(projectId: string): Promise<Project | undefined> | Project | undefined;
  /** Replace the project's memberships and advance its version; returns the new one. */
  writeMembers(projectId: string, members: ProjectMember[]): Promise<string> | string;
}

/**
 * Mirrors the database rules so the mock never accepts what PostgreSQL
 * refuses. There is no authentication in the mock, so no authority check.
 */
export function createInMemoryProjectTeamService(
  store: TeamProjectStore,
  options: { now?: () => string; newId?: () => string } = {}
): ProjectTeamService {
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? (() => crypto.randomUUID());

  async function load(projectId: string, version: string): Promise<{ project: Project; members: ProjectMember[] }> {
    const project = await store.read(projectId);
    if (!project) throw new ProjectTeamError("not_found");
    if (project.status === "archived") throw new ProjectTeamError("project_archived");
    if (project.updatedAt !== version) throw new ProjectTeamError("stale");
    if (!project.members) throw new ProjectTeamError("unavailable");
    return { project, members: project.members.map((member) => ({ ...member })) };
  }

  function checkReferences(project: Project, members: ProjectMember[], memberId: string | undefined,
    partyId: string, reportsTo: string | undefined) {
    if (!project.parties?.some((party) => party.id === partyId)) throw new ProjectTeamError("party_invalid");
    if (!reportsTo) return;
    if (reportsTo === memberId) throw new ProjectTeamError("self_report");
    const target = members.find((member) => member.id === reportsTo);
    if (!target || target.endedAt) throw new ProjectTeamError("reports_to_invalid");
    if (wouldCreateCycle(members, memberId, reportsTo)) throw new ProjectTeamError("reports_to_cycle");
  }

  async function save(projectId: string, members: ProjectMember[], memberId: string): Promise<MemberWriteResult> {
    const version = await store.writeMembers(projectId, members);
    return { memberId, version };
  }

  return {
    async addMember(input) {
      assertDraft(input, true);
      const { project, members } = await load(input.projectId, input.version);
      if (members.some((member) => member.contactId === input.contactId && !member.endedAt)) {
        throw new ProjectTeamError("already_member");
      }
      checkReferences(project, members, undefined, input.partyId, input.reportsToMemberId);
      const timestamp = now();
      const member: ProjectMember = {
        id: newId(), projectId: input.projectId, contactId: input.contactId, partyId: input.partyId,
        projectRole: input.projectRole.trim().slice(0, PROJECT_ROLE_MAX),
        reportsToMemberId: input.reportsToMemberId, createdAt: timestamp, updatedAt: timestamp,
      };
      return save(input.projectId, [...members, member], member.id);
    },
    async updateMember(input) {
      assertDraft(input, false);
      const { project, members } = await load(input.projectId, input.version);
      const index = members.findIndex((member) => member.id === input.memberId && !member.endedAt);
      if (index < 0) throw new ProjectTeamError("not_found");
      checkReferences(project, members, input.memberId, input.partyId, input.reportsToMemberId);
      members[index] = {
        ...members[index], partyId: input.partyId, projectRole: input.projectRole.trim(),
        reportsToMemberId: input.reportsToMemberId, updatedAt: now(),
      };
      return save(input.projectId, members, input.memberId);
    },
    async endMember(input) {
      const { members } = await load(input.projectId, input.version);
      const index = members.findIndex((member) => member.id === input.memberId && !member.endedAt);
      if (index < 0) throw new ProjectTeamError("not_found");
      if (members.some((member) => member.reportsToMemberId === input.memberId && !member.endedAt)) {
        throw new ProjectTeamError("has_active_reports");
      }
      const timestamp = now();
      members[index] = { ...members[index], endedAt: timestamp, updatedAt: timestamp };
      return save(input.projectId, members, input.memberId);
    },
  };
}

/* -------------------------------- selection -------------------------------- */

export const projectTeamService: ProjectTeamService = isSupabaseConfigured()
  ? createSupabaseProjectTeamService(() => getSupabaseBrowserClient() as unknown as TeamClient)
  : createInMemoryProjectTeamService({
      // Lazy: the mock project service is the store, and importing it statically
      // would tie the two modules into a cycle.
      async read(projectId) {
        const { readMockProject } = await import("./project-service");
        return readMockProject(projectId);
      },
      async writeMembers(projectId, members) {
        const { writeMockProjectMembers } = await import("./project-service");
        return writeMockProjectMembers(projectId, members);
      },
    });
