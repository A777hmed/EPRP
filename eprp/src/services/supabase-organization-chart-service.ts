import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  OrganizationChartRow,
  OrganizationPositionRow,
  PositionAssignmentHistoryRow,
} from "@/lib/supabase/database.types";
import type {
  OrganizationChart,
  OrganizationPosition,
  PositionAssignmentHistoryEntry,
} from "@/types";
import {
  buildPositionTree,
  collectDescendantIds,
  wouldCreateCycle,
} from "@/lib/organization-tree";
import { canTransitionTo } from "@/lib/organization-lock";
import type {
  OrganizationChartService,
  PositionTreeInput,
} from "./organization-chart-service";

/**
 * Supabase-backed organization-chart service (OC-2).
 *
 * Activated only when Supabase is configured; the in-memory mock is used
 * otherwise. Hierarchy edits go through `parent_position_id` — no
 * coordinates are read or written anywhere in this file.
 */

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/* -------------------------------- Mapping --------------------------------- */

function rowToChart(row: OrganizationChartRow): OrganizationChart {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status as OrganizationChart["status"],
    source: row.source as OrganizationChart["source"],
    chartType: (row.chart_type as OrganizationChart["chartType"]) ?? undefined,
    effectiveDate: row.effective_date ?? undefined,
    version: row.version,
    isCurrent: row.is_current,
    supersedesChartId: row.supersedes_chart_id ?? undefined,
    active: row.active,
    archivedAt: row.archived_at ?? undefined,
    createdBy: row.created_by ?? undefined,
    updatedBy: row.updated_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPosition(row: OrganizationPositionRow): OrganizationPosition {
  return {
    id: row.id,
    chartId: row.chart_id,
    projectId: row.project_id,
    parentPositionId: row.parent_position_id ?? undefined,
    title: row.title,
    code: row.code ?? undefined,
    role: row.role ?? undefined,
    notes: row.notes ?? undefined,
    departmentId: row.department_id ?? undefined,
    disciplineId: row.discipline_id ?? undefined,
    contactId: row.contact_id ?? undefined,
    company: row.company ?? undefined,
    employmentType:
      (row.employment_type as OrganizationPosition["employmentType"]) ??
      undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    status: row.status as OrganizationPosition["status"],
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    sortOrder: row.sort_order,
    active: row.active,
    archivedAt: row.archived_at ?? undefined,
    createdBy: row.created_by ?? undefined,
    updatedBy: row.updated_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToHistory(
  row: PositionAssignmentHistoryRow
): PositionAssignmentHistoryEntry {
  return {
    id: row.id,
    positionId: row.position_id,
    chartId: row.chart_id,
    projectId: row.project_id,
    contactId: row.contact_id ?? undefined,
    previousContactId: row.previous_contact_id ?? undefined,
    action: row.action as PositionAssignmentHistoryEntry["action"],
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to ?? undefined,
    note: row.note ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
  };
}

/* -------------------------------- Reads ----------------------------------- */

async function fetchPosition(positionId: string): Promise<OrganizationPosition> {
  const { data, error } = await client()
    .from("organization_positions")
    .select("*")
    .eq("id", positionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Position ${positionId} not found`);
  return rowToPosition(data as OrganizationPositionRow);
}

async function fetchActivePositions(
  chartId: string
): Promise<OrganizationPosition[]> {
  const { data, error } = await client()
    .from("organization_positions")
    .select("*")
    .eq("chart_id", chartId)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as OrganizationPositionRow[]).map(rowToPosition);
}

/* -------------------------------- Service --------------------------------- */

export const supabaseOrganizationChartService: OrganizationChartService = {
  async listCharts(projectId) {
    const { data, error } = await client()
      .from("organization_charts")
      .select("*")
      .eq("project_id", projectId)
      .eq("active", true)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as OrganizationChartRow[]).map(rowToChart);
  },

  async getChart(chartId) {
    const { data, error } = await client()
      .from("organization_charts")
      .select("*")
      .eq("id", chartId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToChart(data as OrganizationChartRow) : null;
  },

  async getActiveChart(projectId) {
    const { data, error } = await client()
      .from("organization_charts")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_current", true)
      .eq("active", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToChart(data as OrganizationChartRow) : null;
  },

  async createChart(input) {
    const { data, error } = await client()
      .from("organization_charts")
      .insert({
        project_id: input.projectId,
        name: input.name,
        description: input.description ?? null,
        source: input.source ?? "blank",
        status: "draft",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return rowToChart(data as OrganizationChartRow);
  },

  async updateChart(chartId, input) {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined)
      patch.description = input.description || null;
    if (input.chartType !== undefined) patch.chart_type = input.chartType;
    if (input.effectiveDate !== undefined)
      patch.effective_date = input.effectiveDate || null;

    const { data, error } = await client()
      .from("organization_charts")
      .update(patch)
      .eq("id", chartId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return rowToChart(data as OrganizationChartRow);
  },

  async activateChart(chartId) {
    const sb = client();
    const chart = await supabaseOrganizationChartService.getChart(chartId);
    if (!chart) throw new Error(`Chart ${chartId} not found`);

    // Stand down the current chart first: the partial unique index would
    // otherwise reject a second current row for this project.
    const { error: standDownError } = await sb
      .from("organization_charts")
      .update({ is_current: false })
      .eq("project_id", chart.projectId)
      .eq("is_current", true)
      .neq("id", chartId);
    if (standDownError) throw new Error(standDownError.message);

    const { data, error } = await sb
      .from("organization_charts")
      .update({ is_current: true })
      .eq("id", chartId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return rowToChart(data as OrganizationChartRow);
  },

  async setChartStatus(chartId, status) {
    const chart = await supabaseOrganizationChartService.getChart(chartId);
    if (!chart) throw new Error(`Chart ${chartId} not found`);
    if (!canTransitionTo(chart.status, status)) {
      throw new Error(`A ${chart.status} chart cannot be moved to ${status}`);
    }

    const { data, error } = await client()
      .from("organization_charts")
      .update({ status })
      .eq("id", chartId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return rowToChart(data as OrganizationChartRow);
  },

  async createRevision(chartId) {
    const sb = client();
    const source = await supabaseOrganizationChartService.getChart(chartId);
    if (!source) throw new Error(`Chart ${chartId} not found`);

    // Stand the source down before inserting, so the partial unique index
    // never sees two current charts for the project.
    const { error: standDownError } = await sb
      .from("organization_charts")
      .update({ is_current: false })
      .eq("project_id", source.projectId)
      .eq("is_current", true);
    if (standDownError) throw new Error(standDownError.message);

    const { data, error } = await sb
      .from("organization_charts")
      .insert({
        project_id: source.projectId,
        name: source.name,
        description: source.description ?? null,
        source: source.source,
        status: "draft",
        version: source.version + 1,
        supersedes_chart_id: source.id,
        is_current: true,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const revision = rowToChart(data as OrganizationChartRow);

    // Copy the positions across parents-first, remapping ids as we go.
    const positions = await fetchActivePositions(chartId);
    const idMap = new Map<string, string>();
    let remaining = [...positions];
    while (remaining.length > 0) {
      const ready = remaining.filter(
        (position) =>
          !position.parentPositionId || idMap.has(position.parentPositionId)
      );
      // A parent that never resolves would loop forever; the data model
      // prevents it, but bail rather than hang if it ever happens.
      if (ready.length === 0) break;

      for (const position of ready) {
        const { data: row, error: insertError } = await sb
          .from("organization_positions")
          .insert({
            chart_id: revision.id,
            project_id: revision.projectId,
            parent_position_id: position.parentPositionId
              ? (idMap.get(position.parentPositionId) ?? null)
              : null,
            title: position.title,
            code: position.code ?? null,
            role: position.role ?? null,
            notes: position.notes ?? null,
            department_id: position.departmentId ?? null,
            discipline_id: position.disciplineId ?? null,
            contact_id: position.contactId ?? null,
            company: position.company ?? null,
            employment_type: position.employmentType ?? null,
            email: position.email ?? null,
            phone: position.phone ?? null,
            status: position.status,
            start_date: position.startDate ?? null,
            end_date: position.endDate ?? null,
            sort_order: position.sortOrder,
          })
          .select("*")
          .single();
        if (insertError) throw new Error(insertError.message);
        idMap.set(position.id, (row as OrganizationPositionRow).id);
      }

      remaining = remaining.filter((position) => !idMap.has(position.id));
    }

    return revision;
  },

  async archiveChart(chartId) {
    const { data, error } = await client()
      .from("organization_charts")
      .update({
        status: "archived",
        is_current: false,
        active: false,
        archived_at: new Date().toISOString(),
      })
      .eq("id", chartId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return rowToChart(data as OrganizationChartRow);
  },

  async listPositions(chartId) {
    return fetchActivePositions(chartId);
  },

  async getPositionTree(chartId) {
    return buildPositionTree(await fetchActivePositions(chartId));
  },

  async createPosition(input) {
    let sortOrder = input.sortOrder;
    if (sortOrder === undefined) {
      // Append after the current siblings.
      const siblings = (await fetchActivePositions(input.chartId)).filter(
        (position) =>
          (position.parentPositionId ?? undefined) ===
          (input.parentPositionId ?? undefined)
      );
      sortOrder = siblings.length;
    }

    const { data, error } = await client()
      .from("organization_positions")
      .insert({
        chart_id: input.chartId,
        project_id: input.projectId,
        parent_position_id: input.parentPositionId ?? null,
        title: input.title,
        code: input.code ?? null,
        role: input.role ?? null,
        notes: input.notes ?? null,
        department_id: input.departmentId ?? null,
        discipline_id: input.disciplineId ?? null,
        contact_id: input.contactId ?? null,
        status: input.contactId ? "active" : "vacant",
        sort_order: sortOrder,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const position = rowToPosition(data as OrganizationPositionRow);

    if (input.contactId) {
      await writeHistory(position, undefined, input.contactId, "assigned");
    }
    return position;
  },

  async updatePosition(positionId, input) {
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.code !== undefined) patch.code = input.code ?? null;
    if (input.role !== undefined) patch.role = input.role ?? null;
    if (input.notes !== undefined) patch.notes = input.notes ?? null;
    if (input.departmentId !== undefined)
      patch.department_id = input.departmentId || null;
    if (input.disciplineId !== undefined)
      patch.discipline_id = input.disciplineId || null;
    if (input.company !== undefined) patch.company = input.company || null;
    if (input.employmentType !== undefined)
      patch.employment_type = input.employmentType || null;
    if (input.email !== undefined) patch.email = input.email || null;
    if (input.phone !== undefined) patch.phone = input.phone || null;
    if (input.status !== undefined) patch.status = input.status;
    if (input.startDate !== undefined)
      patch.start_date = input.startDate || null;
    if (input.endDate !== undefined) patch.end_date = input.endDate || null;

    const { data, error } = await client()
      .from("organization_positions")
      .update(patch)
      .eq("id", positionId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return rowToPosition(data as OrganizationPositionRow);
  },

  async movePosition(positionId, parentPositionId, sortOrder) {
    const position = await fetchPosition(positionId);
    const positions = await fetchActivePositions(position.chartId);
    // The database enforces same-chart parents but cannot see cycles.
    if (wouldCreateCycle(positions, positionId, parentPositionId)) {
      throw new Error("A position cannot be moved beneath itself.");
    }

    let order = sortOrder;
    if (order === undefined) {
      order = positions.filter(
        (candidate) =>
          candidate.id !== positionId &&
          (candidate.parentPositionId ?? undefined) ===
            (parentPositionId ?? undefined)
      ).length;
    }

    const { data, error } = await client()
      .from("organization_positions")
      .update({
        parent_position_id: parentPositionId ?? null,
        sort_order: order,
      })
      .eq("id", positionId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return rowToPosition(data as OrganizationPositionRow);
  },

  async applyPositionTree(chartId, nodes, options) {
    const sb = client();
    const chart = await supabaseOrganizationChartService.getChart(chartId);
    if (!chart) throw new Error(`Chart ${chartId} not found`);

    if (options?.replaceExisting) {
      const { error } = await sb
        .from("organization_positions")
        .update({ active: false, archived_at: new Date().toISOString() })
        .eq("chart_id", chartId)
        .eq("active", true);
      if (error) throw new Error(error.message);
    }

    const created: OrganizationPosition[] = [];
    // Sequential by depth: a child needs its parent's generated id, so the
    // rows cannot be inserted in one batch.
    const walk = async (
      list: PositionTreeInput[],
      parentPositionId: string | undefined
    ) => {
      for (const [index, node] of list.entries()) {
        const { data, error } = await sb
          .from("organization_positions")
          .insert({
            chart_id: chartId,
            project_id: chart.projectId,
            parent_position_id: parentPositionId ?? null,
            title: node.title,
            code: node.code ?? null,
            role: node.role ?? null,
            status: "vacant",
            sort_order: index,
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);
        const position = rowToPosition(data as OrganizationPositionRow);
        created.push(position);
        await walk(node.children ?? [], position.id);
      }
    };
    await walk(nodes, undefined);

    return created;
  },

  async duplicatePosition(positionId) {
    const source = await fetchPosition(positionId);
    const siblings = (await fetchActivePositions(source.chartId)).filter(
      (candidate) =>
        (candidate.parentPositionId ?? undefined) ===
        (source.parentPositionId ?? undefined)
    );

    const { data, error } = await client()
      .from("organization_positions")
      .insert({
        chart_id: source.chartId,
        project_id: source.projectId,
        parent_position_id: source.parentPositionId ?? null,
        title: source.title + " (copy)",
        // Codes identify a single seat, so the copy starts without one.
        code: null,
        role: source.role ?? null,
        notes: source.notes ?? null,
        department_id: source.departmentId ?? null,
        discipline_id: source.disciplineId ?? null,
        company: source.company ?? null,
        employment_type: source.employmentType ?? null,
        email: source.email ?? null,
        phone: source.phone ?? null,
        start_date: source.startDate ?? null,
        end_date: source.endDate ?? null,
        // A seat is duplicated, not its occupant.
        contact_id: null,
        status: "vacant",
        sort_order: siblings.length,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return rowToPosition(data as OrganizationPositionRow);
  },

  async reorderSiblings(orderedIds) {
    // Sequential rather than a bulk upsert: each row already exists, and an
    // upsert would need every non-null column restated.
    for (const [index, id] of orderedIds.entries()) {
      const { error } = await client()
        .from("organization_positions")
        .update({ sort_order: index })
        .eq("id", id);
      if (error) throw new Error(error.message);
    }
  },

  async archivePosition(positionId) {
    const position = await fetchPosition(positionId);
    const positions = await fetchActivePositions(position.chartId);

    // Soft delete has no cascade, so collect the branch and archive it all.
    const doomed = collectDescendantIds(positions, positionId);

    const { error } = await client()
      .from("organization_positions")
      .update({ active: false, archived_at: new Date().toISOString() })
      .in("id", [...doomed]);
    if (error) throw new Error(error.message);
    return fetchPosition(positionId);
  },

  async assignContact(positionId, contactId, options) {
    const existing = await fetchPosition(positionId);
    if (existing.contactId === contactId) return existing;

    const { data, error } = await client()
      .from("organization_positions")
      .update({ contact_id: contactId ?? null })
      .eq("id", positionId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const position = rowToPosition(data as OrganizationPositionRow);

    const action = !contactId
      ? "vacated"
      : existing.contactId
        ? "reassigned"
        : "assigned";
    await writeHistory(
      position,
      existing.contactId,
      contactId,
      action,
      options
    );
    return position;
  },

  async listAssignmentHistory(scope) {
    const query = client()
      .from("position_assignment_history")
      .select("*")
      .order("created_at", { ascending: false });

    const { data, error } = await ("positionId" in scope
      ? query.eq("position_id", scope.positionId)
      : query.eq("chart_id", scope.chartId));
    if (error) throw new Error(error.message);
    return ((data ?? []) as PositionAssignmentHistoryRow[]).map(rowToHistory);
  },
};

async function writeHistory(
  position: OrganizationPosition,
  previousContactId: string | undefined,
  contactId: string | undefined,
  action: PositionAssignmentHistoryEntry["action"],
  options?: { note?: string; effectiveFrom?: string }
): Promise<void> {
  const { error } = await client().from("position_assignment_history").insert({
    position_id: position.id,
    chart_id: position.chartId,
    project_id: position.projectId,
    contact_id: contactId ?? null,
    previous_contact_id: previousContactId ?? null,
    action,
    effective_from: options?.effectiveFrom ?? today(),
    effective_to: null,
    note: options?.note ?? null,
  });
  if (error) throw new Error(error.message);
}
