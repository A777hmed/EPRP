import "server-only";

/**
 * Executive AI — a server-side writing assistant.
 *
 * WHAT THIS IS: a drafting and rewriting aid. It turns figures the platform
 * already reported into management prose. It is NOT a data source, it is never
 * consulted for a number, and nothing it returns is authoritative.
 *
 * WHY IT IS SERVER-ONLY: the provider key must never reach the browser. This
 * module is `server-only`, is reached exclusively through the API route, and
 * the key is read from the environment at call time.
 *
 * PROVIDER ABSTRACTION: the Executive UI talks to the three functions at the
 * bottom of this file and knows nothing about the provider. Swapping vendors
 * means editing `callProvider()` and the environment — no UI change. Plain
 * `fetch` is used deliberately so no SDK dependency is introduced.
 *
 * DEGRADATION: when the key is absent every entry point returns
 * `{ available: false }`. The route reports that plainly and the workspace
 * hides its AI controls. Manual Executive editing is entirely unaffected —
 * nothing in the report depends on this module being configured.
 */

/* ------------------------------ Configuration ------------------------------ */

export interface AiConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  provider: string;
}

/**
 * Read provider settings from the environment.
 *
 * `EXECUTIVE_AI_API_KEY` is preferred so the Executive assistant can be given
 * its own credential; `ANTHROPIC_API_KEY` is accepted as the conventional
 * fallback. Neither is `NEXT_PUBLIC_`, so neither can be bundled into client
 * code even by accident.
 */
export function readAiConfig(): AiConfig | null {
  const apiKey = process.env.EXECUTIVE_AI_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  return {
    apiKey,
    model: process.env.EXECUTIVE_AI_MODEL ?? "claude-sonnet-5",
    baseUrl: process.env.EXECUTIVE_AI_BASE_URL ?? "https://api.anthropic.com/v1/messages",
    provider: process.env.EXECUTIVE_AI_PROVIDER ?? "anthropic",
  };
}

export function isAiConfigured(): boolean {
  return readAiConfig() !== null;
}

/* -------------------------------- Contracts -------------------------------- */

export type AiResult =
  | { ok: true; text: string }
  | { ok: false; available: boolean; message: string };

/**
 * The minimum structured context a draft needs.
 *
 * Deliberately narrow: figures, labels and short text the caller is already
 * authorized to see. No identifiers, no rows the reader cannot open, no
 * database dump. The API route validates this shape and caps every list before
 * anything is sent.
 */
export interface ExecutiveAiContext {
  monthLabel: string;
  projectCount: number;
  approvedCount: number;
  provisional: boolean;
  planned?: number;
  actual?: number;
  variance?: number;
  healthCounts: { label: string; count: number }[];
  projects: {
    name: string;
    client?: string;
    planned?: number;
    actual?: number;
    variance?: number;
    health: string;
    basis: string;
    keyConcern?: string;
    movement?: string;
    nextMilestone?: string;
  }[];
  achievements: string[];
  risks: string[];
  decisions: string[];
  clientDependencies: string[];
  milestones: string[];
  notes: string[];
}

export type RewriteMode =
  | "improve"
  | "professional"
  | "executive"
  | "concise"
  | "summarize"
  | "expand"
  | "grammar"
  | "simplify";

const REWRITE_INSTRUCTION: Record<RewriteMode, string> = {
  improve: "Improve the clarity and flow of the writing.",
  professional: "Make the tone more formal and professional.",
  executive: "Make it read as senior-management reporting: direct, decision-oriented, no operational detail.",
  concise: "Make it materially shorter while keeping every fact.",
  summarize: "Summarise it into a short management statement.",
  expand: "Expand it into clearer full sentences WITHOUT adding any new fact.",
  grammar: "Correct grammar, spelling and punctuation only.",
  simplify: "Simplify the wording for a non-specialist reader.",
};

/* --------------------------------- Guardrails ------------------------------- */

/**
 * The anti-fabrication contract, applied to every call.
 *
 * This is the single most important part of the module. An executive report
 * that invents a risk or rounds a percentage is worse than no report at all,
 * so the rule is stated absolutely and repeated in the user turn rather than
 * left to the model's judgement.
 */
const SYSTEM_RULES = [
  "You draft written summaries for a construction and engineering project portfolio report read by a Chairman and senior management.",
  "",
  "ABSOLUTE RULES:",
  "- Use ONLY the facts in the supplied data. Never invent projects, numbers, percentages, dates, names, risks, actions, milestones, decisions or statuses.",
  "- Never estimate, extrapolate or round a figure that was not supplied. Reproduce figures exactly as given.",
  "- If a topic has no supporting data, either omit it entirely or write 'No material item has been reported in this area.'",
  "- Never describe something as approved, complete, on track or resolved unless the data says so.",
  "- Do not add recommendations, opinions or causes that are not in the data.",
  "- Write plain professional British-English prose. No markdown, no bullet characters, no headings unless asked.",
].join("\n");

const REWRITE_RULES = [
  "You are an editor for senior-management reporting text.",
  "",
  "ABSOLUTE RULES:",
  "- Preserve the original technical meaning exactly.",
  "- Never change a number, percentage, date, project name, person's name, responsibility or technical term.",
  "- Never add a fact that is not in the original text, and never remove a material fact.",
  "- Return ONLY the rewritten text, with no preamble and no commentary.",
].join("\n");

/* ------------------------------ Provider call ------------------------------ */

/**
 * The one place a provider is spoken to.
 *
 * Everything above is provider-neutral. To change vendor, change this function.
 */
async function callProvider(system: string, user: string, maxTokens: number): Promise<AiResult> {
  const config = readAiConfig();
  if (!config) {
    return {
      ok: false,
      available: false,
      message: "The AI assistant is not configured on this server.",
    };
  }

  try {
    const response = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
      // A drafting aid must never hold a report page open indefinitely.
      signal: AbortSignal.timeout(45_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        ok: false,
        available: true,
        // The provider's raw body can carry account details; keep it server-side.
        message: `The AI assistant could not complete the request (status ${response.status}).${
          detail ? "" : ""
        }`,
      };
    }

    const payload = (await response.json()) as { content?: { type: string; text?: string }[] };
    const text = (payload.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!text) {
      return { ok: false, available: true, message: "The AI assistant returned an empty draft." };
    }
    return { ok: true, text };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      available: true,
      message: timedOut
        ? "The AI assistant timed out. The report is unaffected — continue editing manually."
        : "The AI assistant is temporarily unavailable. The report is unaffected — continue editing manually.",
    };
  }
}

/* ------------------------------- Context text ------------------------------ */

function line(label: string, value: string | number | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  return `${label}: ${value}`;
}

function list(label: string, values: string[]): string | undefined {
  if (values.length === 0) return `${label}: none reported`;
  return `${label}:\n${values.map((value) => `  - ${value}`).join("\n")}`;
}

/** Render the context as plain labelled facts — no invention surface. */
function renderContext(context: ExecutiveAiContext): string {
  const parts: (string | undefined)[] = [
    line("Reporting period", context.monthLabel),
    line("Projects in view", context.projectCount),
    line("Projects on an approved Monthly basis", `${context.approvedCount} of ${context.projectCount}`),
    context.provisional
      ? "Approval status: figures are PROVISIONAL — no approved Monthly Report for this period"
      : "Approval status: figures are compiled from approved Monthly Reports",
    line("Portfolio planned %", context.planned),
    line("Portfolio actual %", context.actual),
    line("Portfolio schedule variance (percentage points)", context.variance),
    context.healthCounts.length
      ? `Schedule health counts: ${context.healthCounts.map((h) => `${h.count} ${h.label}`).join(", ")}`
      : undefined,
    "",
    "PROJECTS:",
    ...context.projects.map((project) =>
      [
        `  - ${project.name}`,
        project.client ? ` (client: ${project.client})` : "",
        `; planned ${project.planned ?? "not reported"}%`,
        `, actual ${project.actual ?? "not reported"}%`,
        `, variance ${project.variance ?? "not reported"}`,
        `; schedule health ${project.health}`,
        `; monthly basis ${project.basis}`,
        project.keyConcern ? `; key concern: ${project.keyConcern}` : "",
        project.nextMilestone ? `; next milestone: ${project.nextMilestone}` : "",
        project.movement ? `; latest weekly movement: ${project.movement}` : "",
      ].join("")
    ),
    "",
    list("Major achievements reported", context.achievements),
    list("Risks and issues reported", context.risks),
    list("Decisions required from management", context.decisions),
    list("Client dependencies", context.clientDependencies),
    list("Upcoming milestones", context.milestones),
    list("Executive notes flagged for the summary", context.notes),
  ];

  return parts.filter((part) => part !== undefined).join("\n");
}

/* -------------------------------- Entry points ----------------------------- */

export async function generateExecutiveSummary(context: ExecutiveAiContext): Promise<AiResult> {
  const user = [
    "Draft the Executive Summary for the portfolio report below.",
    "",
    "Cover, in this order, and ONLY where the data supports it:",
    "1. Overall portfolio position",
    "2. Major achievements",
    "3. Projects requiring attention",
    "4. Key risks and constraints",
    "5. Client dependencies",
    "6. Management decisions required",
    "7. Upcoming priorities and milestones",
    "",
    "Write 120-220 words as flowing prose in 2-4 paragraphs. No headings, no bullets.",
    "State the approval caveat once, at the end, if the figures are provisional.",
    "",
    "REPORT DATA:",
    renderContext(context),
  ].join("\n");

  return callProvider(SYSTEM_RULES, user, 1200);
}

export async function generateProjectSnapshot(
  context: ExecutiveAiContext,
  projectName: string
): Promise<AiResult> {
  const project = context.projects.find((entry) => entry.name === projectName);
  if (!project) {
    return { ok: false, available: true, message: "That project is not part of the current report." };
  }

  const user = [
    `Write a concise executive snapshot for the project "${projectName}".`,
    "",
    "Cover only what the data supports, in short labelled lines:",
    "Current Position, Major Achievement, Main Concern, Decision Required, Next Milestone, Latest Weekly Movement.",
    "Where an item has no data, write 'No material item has been reported in this area.'",
    "Maximum 90 words in total.",
    "",
    "REPORT DATA:",
    renderContext(context),
  ].join("\n");

  return callProvider(SYSTEM_RULES, user, 700);
}

export async function summariseManagementAttention(context: ExecutiveAiContext): Promise<AiResult> {
  const user = [
    "Summarise the management attention items below into a short professional paragraph for senior management.",
    "",
    "Present them in order of the severity ALREADY RECORDED in the data.",
    "Do not reclassify, escalate or downgrade any item. Do not invent severity.",
    "Maximum 90 words.",
    "",
    "REPORT DATA:",
    renderContext(context),
  ].join("\n");

  return callProvider(SYSTEM_RULES, user, 600);
}

export async function rewriteExecutiveText(text: string, mode: RewriteMode): Promise<AiResult> {
  const user = [REWRITE_INSTRUCTION[mode], "", "TEXT:", text].join("\n");
  // Generous ceiling so an "expand" never returns truncated mid-sentence.
  return callProvider(REWRITE_RULES, user, Math.max(600, text.length));
}
