import { z } from "zod";

import type { Project } from "@/types";
import { PROJECT_LIFECYCLE_META } from "@/lib/constants";

/**
 * Project form schemas (Phase 5A validation update).
 *
 * One shared base schema carries every field with format-only validation;
 * two entry points build on it without duplicating definitions:
 *
 * - `createProjectDraftSchema`  — Save Draft: only name + code required,
 *   any filled optional value must still be well-formed.
 * - `createProjectFinalSchema`  — Create/Save: all mandatory and
 *   conditional rules enforced via superRefine.
 *
 * Number inputs use NaN as "empty" so progress values can stay blank on
 * drafts and planning-stage projects.
 */

/* ----------------------------- Field fragments ---------------------------- */

/**
 * The base shape is deliberately lenient — every rule lives in the refine
 * passes below. In Zod 4, object-level superRefine only runs when the base
 * shape parses, so strict base fields would silently skip the mandatory /
 * conditional checks (and `z.number()` alone rejects the NaN we use to
 * represent "not entered yet").
 */

const optionalText = z.string().trim().max(200).optional().or(z.literal(""));

/** number OR NaN ("not entered yet"); ranges are refined later. */
const looseNumber = z.union([z.number(), z.nan()]);

const optionalIsoDate = z.string().optional().or(z.literal(""));

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const systemAssignmentSchema = z.object({
  id: z.string(),
  name: z.string().trim().max(120),
  code: optionalText,
  projectDescription: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const departmentAssignmentSchema = z.object({
  departmentId: z.string(),
  projectDescription: z.string().trim().max(2000).optional().or(z.literal("")),
  leadName: optionalText,
  reportingRequired: z.boolean(),
  systems: z.array(systemAssignmentSchema),
});

/**
 * One row of the Additional Project Roles / Positions table.
 *
 * Blank rows are tolerated while editing — the user adds a row before picking
 * either side of it — and are dropped on save rather than rejected.
 */
export const additionalProjectPositionSchema = z.object({
  id: z.string().optional().or(z.literal("")),
  jobTitleId: z.string().optional().or(z.literal("")),
  contactId: z.string().optional().or(z.literal("")),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});

export const additionalProjectSiteSchema = z.object({
  id: z.string().optional().or(z.literal("")),
  name: optionalText,
  country: optionalText,
  city: optionalText,
});

const codePattern = /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/;

const lifecycleValues = Object.keys(PROJECT_LIFECYCLE_META) as [
  keyof typeof PROJECT_LIFECYCLE_META,
  ...(keyof typeof PROJECT_LIFECYCLE_META)[],
];

/* ------------------------------- Base schema ------------------------------ */

function createBaseSchema() {
  return z.object({
    // 1 — Basic information
    name: z.string().trim().max(140),
    code: z.string().trim().max(24),
    shortName: optionalText,
    clientId: z.string(),
    contractNumber: optionalText,
    purchaseOrderNumber: optionalText,
    description: z.string().trim().max(2000).optional().or(z.literal("")),
    projectTypeId: z.string().optional().or(z.literal("")),

    // 2 — Dates (all optional here; the final schema enforces which are required)
    contractStartDate: optionalIsoDate,
    plannedStartDate: optionalIsoDate,
    actualStartDate: optionalIsoDate,
    plannedFinishDate: optionalIsoDate,
    forecastFinishDate: optionalIsoDate,
    actualFinishDate: optionalIsoDate,

    // 3 — Responsibility
    projectManagerId: z.string(),
    projectControlManagerId: z.string().optional().or(z.literal("")),
    clientRepresentativeId: z.string().optional().or(z.literal("")),
    reportingCoordinatorId: z.string().optional().or(z.literal("")),
    projectSponsorId: z.string().optional().or(z.literal("")),
    /** Open-ended positions beside the five fixed roles above. */
    additionalPositions: z.array(additionalProjectPositionSchema),

    // 4 — Status & progress
    status: z.enum(lifecycleValues, "Select a project status"),
    overallStatus: z.enum([
      "on_track",
      "at_risk",
      "behind",
      "critical",
      "completed",
    ]),
    plannedProgress: looseNumber,
    actualProgress: looseNumber,
    currentPhaseId: z.string().optional().or(z.literal("")),
    priority: z.enum(["low", "medium", "high", "critical"]),

    // 5 — Reporting configuration
    weeklyEnabled: z.boolean(),
    monthlyEnabled: z.boolean(),
    executiveEnabled: z.boolean(),
    weeklyReportingDay: z
      .enum([
        "saturday",
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
      ])
      .optional(),
    monthlyCutoffDay: looseNumber,
    milestoneUpdateApproval: z.enum([
      "manual",
      "auto_on_report_finalized",
    ]),
    currency: z.string(),
    workingWeek: z.string(),
    timeZone: z.string(),

    // 6 — Contact & location
    primarySiteId: z.string().optional().or(z.literal("")),
    site: optionalText,
    country: optionalText,
    city: optionalText,
    additionalSites: z.array(additionalProjectSiteSchema),
    clientContactName: optionalText,
    clientContactEmail: z.string().trim().optional().or(z.literal("")),
    clientContactPhone: optionalText,

    // 7 — Departments & systems
    departments: z.array(departmentAssignmentSchema),

    // 8 — Branding & report settings (logo refs hold data URLs — no length cap)
    projectLogoRef: z.string().optional().or(z.literal("")),
    clientLogoRef: z.string().optional().or(z.literal("")),
    reportHeaderTitle: optionalText,
    reportFooterText: optionalText,
    reportReferencePrefix: optionalText,
    defaultLanguage: z.enum(["en", "ar"]),
    includeQrCode: z.boolean(),
    includeSignatureSection: z.boolean(),
  });
}

type BaseValues = z.infer<ReturnType<typeof createBaseSchema>>;

/* ----------------------------- Shared refinements ------------------------- */

/**
 * Format rules applied to drafts AND final submissions: name/code identity,
 * code uniqueness, email shape, numeric ranges, and date ordering.
 */
function createFormatIssues(usedCodes: string[]) {
  const normalizedUsed = new Set(usedCodes.map((c) => c.toUpperCase()));

  return (values: BaseValues, ctx: z.RefinementCtx): void => {
    if (!values.name || values.name.length < 5) {
      ctx.addIssue({
        code: "custom",
        path: ["name"],
        message: "Project name must be at least 5 characters",
      });
    }
    if (!values.code || values.code.length < 3) {
      ctx.addIssue({
        code: "custom",
        path: ["code"],
        message: "Project code is required",
      });
    } else if (!codePattern.test(values.code.toUpperCase())) {
      ctx.addIssue({
        code: "custom",
        path: ["code"],
        message:
          "Use uppercase letters, numbers, and dashes — e.g. PRJ-001, PSAIM-001, EPROM-2026-001",
      });
    } else if (normalizedUsed.has(values.code.toUpperCase())) {
      ctx.addIssue({
        code: "custom",
        path: ["code"],
        message: "This project code is already in use",
      });
    }

    if (
      values.clientContactEmail &&
      !emailPattern.test(values.clientContactEmail)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["clientContactEmail"],
        message: "Enter a valid email address, e.g. name@company.com",
      });
    }

    for (const key of ["plannedProgress", "actualProgress"] as const) {
      const value = values[key];
      if (!Number.isNaN(value) && (value < 0 || value > 100)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Progress must be between 0 and 100",
        });
      }
    }
    if (
      !Number.isNaN(values.monthlyCutoffDay) &&
      (!Number.isInteger(values.monthlyCutoffDay) ||
        values.monthlyCutoffDay < 1 ||
        values.monthlyCutoffDay > 28)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["monthlyCutoffDay"],
        message: "Cut-off day must be between 1 and 28",
      });
    }

    addDateOrderIssues(values, ctx);
  };
}

function addDateOrderIssues(values: BaseValues, ctx: z.RefinementCtx): void {
  if (
    values.plannedFinishDate &&
    values.plannedStartDate &&
    values.plannedFinishDate < values.plannedStartDate
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["plannedFinishDate"],
      message: `Planned finish (${values.plannedFinishDate}) is before planned start (${values.plannedStartDate})`,
    });
  }
  if (
    values.actualFinishDate &&
    values.actualStartDate &&
    values.actualFinishDate < values.actualStartDate
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["actualFinishDate"],
      message: `Actual finish (${values.actualFinishDate}) is before actual start (${values.actualStartDate})`,
    });
  }
  const forecastBaseline = values.actualStartDate || values.plannedStartDate;
  if (
    values.forecastFinishDate &&
    forecastBaseline &&
    values.forecastFinishDate < forecastBaseline
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["forecastFinishDate"],
      message: `Forecast finish (${values.forecastFinishDate}) is before the project start (${forecastBaseline})`,
    });
  }
}

/** Statuses in which a project is (or was) running, not just planned. */
const RUNNING_STATUSES: BaseValues["status"][] = [
  "active",
  "delayed",
  "on_hold",
  "completed",
];

function addFinalIssues(values: BaseValues, ctx: z.RefinementCtx): void {
  const require = (
    path: (string | number)[],
    present: boolean,
    message: string
  ) => {
    if (!present) ctx.addIssue({ code: "custom", path, message });
  };

  // Basic information
  require(["clientId"], !!values.clientId, "Select a client");
  require(["projectTypeId"], !!values.projectTypeId, "Select a project type");
  require(
    ["description"],
    !!values.description?.trim(),
    "Add a short project description"
  );

  // Dates
  require(
    ["plannedStartDate"],
    !!values.plannedStartDate,
    "Planned start date is required"
  );
  require(
    ["plannedFinishDate"],
    !!values.plannedFinishDate,
    "Planned finish date is required"
  );

  // Responsibility
  require(
    ["projectManagerId"],
    !!values.projectManagerId,
    "Select a project manager"
  );
  require(
    ["projectControlManagerId"],
    !!values.projectControlManagerId,
    "Select a project control manager"
  );
  require(
    ["reportingCoordinatorId"],
    !!values.reportingCoordinatorId,
    "Select a reporting coordinator"
  );

  // Status & progress
  require(["currentPhaseId"], !!values.currentPhaseId, "Select the current phase");
  const running = RUNNING_STATUSES.includes(values.status);
  if (running) {
    const statusLabel = PROJECT_LIFECYCLE_META[values.status].label.toLowerCase();
    require(
      ["actualStartDate"],
      !!values.actualStartDate,
      `Actual start date is required for ${statusLabel} projects`
    );
    require(
      ["plannedProgress"],
      !Number.isNaN(values.plannedProgress),
      "Planned progress is required once the project has started"
    );
    require(
      ["actualProgress"],
      !Number.isNaN(values.actualProgress),
      "Actual progress is required once the project has started"
    );
  }
  if (values.status === "completed") {
    require(
      ["actualFinishDate"],
      !!values.actualFinishDate,
      "Completed projects require an actual finish date"
    );
  }
  if (values.overallStatus === "behind" || values.overallStatus === "critical") {
    require(
      ["forecastFinishDate"],
      !!values.forecastFinishDate,
      "Forecast finish date is required when the project is behind or critical"
    );
  }

  // Reporting configuration
  const anyReporting =
    values.weeklyEnabled || values.monthlyEnabled || values.executiveEnabled;
  require(
    ["weeklyEnabled"],
    anyReporting,
    "Enable at least one reporting type (weekly, monthly, or executive)"
  );
  if (values.weeklyEnabled) {
    require(
      ["weeklyReportingDay"],
      !!values.weeklyReportingDay,
      "Weekly reporting day is required when weekly reporting is enabled"
    );
  }
  if (values.monthlyEnabled) {
    require(
      ["monthlyCutoffDay"],
      !Number.isNaN(values.monthlyCutoffDay),
      "Monthly cut-off day is required when monthly reporting is enabled"
    );
  }
  require(["currency"], !!values.currency, "Select a reporting currency");
  require(["workingWeek"], !!values.workingWeek, "Select a working week");
  require(["timeZone"], !!values.timeZone, "Select a time zone");

  // Location
  require(["country"], !!values.country?.trim(), "Country is required");
  require(["site"], !!values.site?.trim(), "Project location is required");
  values.additionalSites.forEach((site, index) => {
    require(
      ["additionalSites", index, "name"],
      !!site.name?.trim(),
      "Site name is required"
    );
  });

  /*
   * Responsibility — additional positions.
   *
   * Both halves are required per row. A row used to be dropped on save when
   * either was blank, which is how a Note ended up carrying the role: the user
   * typed "Site Manager" into Note, left Position empty, and the row silently
   * disappeared. Flagging it names the real problem instead.
   */
  values.additionalPositions.forEach((position, index) => {
    require(
      ["additionalPositions", index, "jobTitleId"],
      !!position.jobTitleId,
      "Select the position this person holds. A Note cannot stand in for it."
    );
    require(
      ["additionalPositions", index, "contactId"],
      !!position.contactId,
      "Select the person who holds this position"
    );
  });

  // Departments, systems, disciplines, and contacts are scope rather than
  // project attributes: the setup wizard owns them and enforces its own
  // requirements. Validating them here too would raise errors this form has
  // no way to fix, since it no longer edits them inline.
}

/* ------------------------------ Entry points ------------------------------ */

/** Save Draft: name + code only, plus format checks on anything filled. */
export function createProjectDraftSchema(usedCodes: string[]) {
  const addFormatIssues = createFormatIssues(usedCodes);
  return createBaseSchema().superRefine(addFormatIssues);
}

/** Create Project / Save Changes: every mandatory and conditional rule. */
export function createProjectFinalSchema(usedCodes: string[]) {
  const addFormatIssues = createFormatIssues(usedCodes);
  return createBaseSchema().superRefine((values, ctx) => {
    addFormatIssues(values, ctx);
    addFinalIssues(values, ctx);
  });
}

export type ProjectFormValues = BaseValues;

/* ------------------------------ Value mapping ----------------------------- */

/** Blank values for the Add Project form. */
export function emptyProjectFormValues(): ProjectFormValues {
  return {
    name: "",
    code: "",
    shortName: "",
    clientId: "",
    contractNumber: "",
    purchaseOrderNumber: "",
    description: "",
    projectTypeId: "",
    contractStartDate: "",
    plannedStartDate: "",
    actualStartDate: "",
    plannedFinishDate: "",
    forecastFinishDate: "",
    actualFinishDate: "",
    projectManagerId: "",
    projectControlManagerId: "",
    clientRepresentativeId: "",
    reportingCoordinatorId: "",
    projectSponsorId: "",
    additionalPositions: [],
    status: "planning",
    overallStatus: "on_track",
    plannedProgress: Number.NaN,
    actualProgress: Number.NaN,
    currentPhaseId: "",
    priority: "medium",
    weeklyEnabled: true,
    monthlyEnabled: true,
    executiveEnabled: true,
    weeklyReportingDay: "thursday",
    monthlyCutoffDay: 25,
    milestoneUpdateApproval: "manual",
    currency: "EGP",
    workingWeek: "Sun – Thu",
    timeZone: "Africa/Cairo",
    primarySiteId: "",
    site: "",
    country: "Egypt",
    city: "",
    additionalSites: [],
    clientContactName: "",
    clientContactEmail: "",
    clientContactPhone: "",
    departments: [],
    projectLogoRef: "",
    clientLogoRef: "",
    reportHeaderTitle: "",
    reportFooterText: "",
    reportReferencePrefix: "",
    defaultLanguage: "en",
    includeQrCode: true,
    includeSignatureSection: true,
  };
}

/** Map a stored project into form values (Edit mode). */
export function projectToFormValues(project: Project): ProjectFormValues {
  const orderedSites = (project.sites ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const primarySite =
    orderedSites.find((site) => site.isPrimary) ?? orderedSites[0];
  const additionalSites = orderedSites
    .filter((site) => site !== primarySite)
    .map((site) => ({
      id: site.id ?? "",
      name: site.name,
      country: site.country ?? "",
      city: site.city ?? "",
    }));

  return {
    name: project.name,
    code: project.code,
    shortName: project.shortName ?? "",
    clientId: project.clientId,
    contractNumber: project.contractNumber ?? "",
    purchaseOrderNumber: project.purchaseOrderNumber ?? "",
    description: project.description ?? "",
    projectTypeId: project.projectTypeId ?? "",
    contractStartDate: project.contractStartDate ?? "",
    plannedStartDate: project.plannedStartDate,
    actualStartDate: project.actualStartDate ?? "",
    plannedFinishDate: project.plannedFinishDate,
    forecastFinishDate: project.forecastFinishDate ?? "",
    actualFinishDate: project.actualFinishDate ?? "",
    projectManagerId: project.projectManagerId,
    projectControlManagerId: project.projectControlManagerId ?? "",
    clientRepresentativeId: project.clientRepresentativeId ?? "",
    reportingCoordinatorId: project.reportingCoordinatorId ?? "",
    projectSponsorId: project.projectSponsorId ?? "",
    additionalPositions: (project.positions ?? [])
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((position) => ({
        id: position.id ?? "",
        jobTitleId: position.jobTitleId,
        contactId: position.contactId,
        notes: position.notes ?? "",
      })),
    status: project.status,
    overallStatus: project.overallStatus,
    plannedProgress: project.plannedProgress,
    actualProgress: project.actualProgress,
    currentPhaseId: project.currentPhaseId ?? "",
    priority: project.priority,
    weeklyEnabled: project.reporting.weeklyEnabled,
    monthlyEnabled: project.reporting.monthlyEnabled,
    executiveEnabled: project.reporting.executiveEnabled,
    weeklyReportingDay: project.reporting.weeklyReportingDay,
    monthlyCutoffDay: project.reporting.monthlyCutoffDay,
    milestoneUpdateApproval: project.reporting.milestoneUpdateApproval,
    currency: project.reporting.currency,
    workingWeek: project.reporting.workingWeek,
    timeZone: project.reporting.timeZone,
    primarySiteId: primarySite?.id ?? "",
    site: primarySite?.name ?? project.location.site ?? "",
    country: primarySite?.country ?? project.location.country ?? "",
    city: primarySite?.city ?? project.location.city ?? "",
    additionalSites,
    clientContactName: project.clientContact.name ?? "",
    clientContactEmail: project.clientContact.email ?? "",
    clientContactPhone: project.clientContact.phone ?? "",
    departments: project.departments.map((d) => ({
      departmentId: d.departmentId,
      projectDescription: d.projectDescription ?? "",
      leadName: d.leadName ?? "",
      reportingRequired: d.reportingRequired,
      systems: d.systems.map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code ?? "",
        projectDescription: s.projectDescription ?? "",
      })),
    })),
    projectLogoRef: project.branding.projectLogoRef ?? "",
    clientLogoRef: project.branding.clientLogoRef ?? "",
    reportHeaderTitle: project.branding.reportHeaderTitle ?? "",
    reportFooterText: project.branding.reportFooterText ?? "",
    reportReferencePrefix: project.branding.reportReferencePrefix ?? "",
    defaultLanguage: project.branding.defaultLanguage,
    includeQrCode: project.branding.includeQrCode,
    includeSignatureSection: project.branding.includeSignatureSection,
  };
}

function blankToUndefined(value: string | undefined): string | undefined {
  return value ? value : undefined;
}

function numberOrZero(value: number): number {
  return Number.isNaN(value) ? 0 : value;
}

/**
 * What a Project Info save is allowed to write: every Project Info scalar
 * group, and **no linked scope records**.
 *
 * `departments`, `disciplines`, and `team` are owned by their own wizard
 * steps. Excluding them at the type level means a Project Info save cannot
 * replace, delete, or recreate project scope even by accident — the compiler
 * rejects it rather than the database silently losing rows.
 */
export type ProjectInfoUpdate = Omit<
  Project,
  "id" | "createdAt" | "updatedAt" | "departments" | "disciplines" | "team"
>;

/**
 * Map validated form values to the Project Info payload.
 *
 * Every key is always present — a field the user cleared arrives as an
 * explicit `undefined`, which the service writes as NULL. That is what keeps
 * "clear this field" working while relation-only updates (which omit these
 * keys entirely) leave Project Info untouched.
 */
export function formValuesToProjectInfoUpdate(
  values: ProjectFormValues,
  options: { asDraft?: boolean } = {}
): ProjectInfoUpdate {
  const { departments: _departments, ...info } = formValuesToProjectInput(
    values,
    options
  );
  void _departments;
  return info;
}

/** Map validated form values to the service input shape. */
export function formValuesToProjectInput(
  values: ProjectFormValues,
  options: { asDraft?: boolean } = {}
): Omit<Project, "id" | "createdAt" | "updatedAt"> {
  return {
    name: values.name,
    code: values.code.toUpperCase(),
    shortName: blankToUndefined(values.shortName),
    description: blankToUndefined(values.description),
    projectTypeId: blankToUndefined(values.projectTypeId),
    clientId: values.clientId,
    contractNumber: blankToUndefined(values.contractNumber),
    purchaseOrderNumber: blankToUndefined(values.purchaseOrderNumber),
    contractStartDate: blankToUndefined(values.contractStartDate),
    plannedStartDate: values.plannedStartDate ?? "",
    actualStartDate: blankToUndefined(values.actualStartDate),
    plannedFinishDate: values.plannedFinishDate ?? "",
    forecastFinishDate: blankToUndefined(values.forecastFinishDate),
    actualFinishDate: blankToUndefined(values.actualFinishDate),
    projectManagerId: values.projectManagerId,
    projectControlManagerId: blankToUndefined(values.projectControlManagerId),
    clientRepresentativeId: blankToUndefined(values.clientRepresentativeId),
    reportingCoordinatorId: blankToUndefined(values.reportingCoordinatorId),
    projectSponsorId: blankToUndefined(values.projectSponsorId),
    status: options.asDraft ? "draft" : values.status,
    overallStatus: values.overallStatus,
    plannedProgress: numberOrZero(values.plannedProgress),
    actualProgress: numberOrZero(values.actualProgress),
    currentPhaseId: blankToUndefined(values.currentPhaseId),
    priority: values.priority,
    reporting: {
      weeklyEnabled: values.weeklyEnabled,
      monthlyEnabled: values.monthlyEnabled,
      executiveEnabled: values.executiveEnabled,
      weeklyReportingDay: values.weeklyReportingDay ?? "thursday",
      monthlyCutoffDay: Number.isNaN(values.monthlyCutoffDay)
        ? 25
        : values.monthlyCutoffDay,
      milestoneUpdateApproval: values.milestoneUpdateApproval,
      currency: values.currency,
      workingWeek: values.workingWeek,
      timeZone: values.timeZone,
    },
    // A row needs both halves to mean anything; half-filled rows are dropped
    // rather than saved as an unassigned position or a person with no role.
    positions: values.additionalPositions
      .filter((position) => position.jobTitleId && position.contactId)
      .map((position, index) => ({
        id: blankToUndefined(position.id),
        jobTitleId: position.jobTitleId ?? "",
        contactId: position.contactId ?? "",
        notes: blankToUndefined(position.notes),
        sortOrder: index,
      })),
    sites: [
      ...(values.site?.trim()
        ? [
            {
              id: blankToUndefined(values.primarySiteId),
              name: values.site.trim(),
              country: blankToUndefined(values.country),
              city: blankToUndefined(values.city),
              isPrimary: true,
              sortOrder: 0,
            },
          ]
        : []),
      ...values.additionalSites
        .filter((site) => site.name?.trim())
        .map((site, index) => ({
          id: blankToUndefined(site.id),
          name: site.name?.trim() ?? "",
          country: blankToUndefined(site.country),
          city: blankToUndefined(site.city),
          isPrimary: false,
          sortOrder: index + 1,
        })),
    ],
    location: {
      site: blankToUndefined(values.site),
      country: blankToUndefined(values.country),
      city: blankToUndefined(values.city),
    },
    clientContact: {
      name: blankToUndefined(values.clientContactName),
      email: blankToUndefined(values.clientContactEmail),
      phone: blankToUndefined(values.clientContactPhone),
    },
    departments: values.departments.map((d) => ({
      departmentId: d.departmentId,
      projectDescription: blankToUndefined(d.projectDescription),
      leadName: blankToUndefined(d.leadName),
      reportingRequired: d.reportingRequired,
      systems: d.systems.map((s) => ({
        id: s.id,
        name: s.name,
        code: blankToUndefined(s.code),
        projectDescription: blankToUndefined(s.projectDescription),
      })),
    })),
    branding: {
      projectLogoRef: blankToUndefined(values.projectLogoRef),
      clientLogoRef: blankToUndefined(values.clientLogoRef),
      reportHeaderTitle: blankToUndefined(values.reportHeaderTitle),
      reportFooterText: blankToUndefined(values.reportFooterText),
      reportReferencePrefix: blankToUndefined(values.reportReferencePrefix),
      defaultLanguage: values.defaultLanguage,
      includeQrCode: values.includeQrCode,
      includeSignatureSection: values.includeSignatureSection,
    },
  };
}
