import { NextResponse } from "next/server";
import { z } from "zod";

import {
  generateExecutiveSummary,
  generateProjectSnapshot,
  isAiConfigured,
  rewriteExecutiveText,
  summariseManagementAttention,
  type ExecutiveAiContext,
} from "@/features/executive-reports/executive-ai";
import { getExecutiveViewerContext } from "@/features/executive-reports/executive-access";

/**
 * The Executive AI endpoint.
 *
 * Three things are enforced here, in this order, before a provider is ever
 * contacted:
 *
 * 1. AUTHORIZATION — the same server-side Executive gate the pages use. A
 *    department account cannot reach this route at all, so it cannot use the
 *    assistant as a side channel onto portfolio data.
 * 2. SHAPE — the request body is parsed by the schema below. Anything not
 *    described here is stripped, so the endpoint cannot be turned into a pipe
 *    for arbitrary content.
 * 3. VOLUME — every list is capped. The caller sends a summary of what is
 *    already on their screen, never a dataset.
 *
 * The provider key is read inside `executive-ai.ts`, which is `server-only`. It
 * is never returned, never logged, and cannot reach the client bundle.
 *
 * A NOTE ON TRUST: the context is supplied by the client rather than rebuilt on
 * the server. That is a deliberate trade-off — the caller can only send figures
 * that row-level security already delivered to them, and the gate above proves
 * they are entitled to the module. It means a caller could send *fewer* facts
 * than they hold, which affects only the quality of their own draft. It does
 * NOT let them reach another reader's data, because nothing here reads the
 * database on their behalf.
 */

const projectSchema = z.object({
  name: z.string().max(200),
  client: z.string().max(200).optional(),
  planned: z.number().optional(),
  actual: z.number().optional(),
  variance: z.number().optional(),
  health: z.string().max(60),
  basis: z.string().max(60),
  keyConcern: z.string().max(600).optional(),
  movement: z.string().max(600).optional(),
  nextMilestone: z.string().max(300).optional(),
});

const contextSchema = z.object({
  monthLabel: z.string().max(60),
  projectCount: z.number().int().min(0).max(500),
  approvedCount: z.number().int().min(0).max(500),
  provisional: z.boolean(),
  planned: z.number().optional(),
  actual: z.number().optional(),
  variance: z.number().optional(),
  healthCounts: z.array(z.object({ label: z.string().max(40), count: z.number().int() })).max(10),
  projects: z.array(projectSchema).max(60),
  achievements: z.array(z.string().max(600)).max(30),
  risks: z.array(z.string().max(600)).max(30),
  decisions: z.array(z.string().max(600)).max(30),
  clientDependencies: z.array(z.string().max(600)).max(30),
  milestones: z.array(z.string().max(300)).max(30),
  notes: z.array(z.string().max(1000)).max(30),
});

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("summary"), context: contextSchema }),
  z.object({ action: z.literal("attention"), context: contextSchema }),
  z.object({ action: z.literal("snapshot"), context: contextSchema, projectName: z.string().max(200) }),
  z.object({
    action: z.literal("rewrite"),
    text: z.string().min(1).max(8000),
    mode: z.enum([
      "improve",
      "professional",
      "executive",
      "concise",
      "summarize",
      "expand",
      "grammar",
      "simplify",
    ]),
  }),
]);

/** Availability probe, so the UI can hide its controls rather than fail on use. */
export async function GET() {
  const viewer = await getExecutiveViewerContext();
  if (!viewer.allowed) {
    return NextResponse.json({ available: false }, { status: 403 });
  }
  return NextResponse.json({ available: isAiConfigured() });
}

export async function POST(request: Request) {
  const viewer = await getExecutiveViewerContext();
  if (!viewer.allowed) {
    return NextResponse.json(
      { ok: false, available: false, message: "Not authorized for Executive reporting." },
      { status: 403 }
    );
  }

  let parsed;
  try {
    parsed = bodySchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ ok: false, available: true, message: "Malformed request." }, { status: 400 });
  }

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, available: true, message: "The request did not match the expected shape." },
      { status: 400 }
    );
  }

  const body = parsed.data;

  const result =
    body.action === "summary"
      ? await generateExecutiveSummary(body.context as ExecutiveAiContext)
      : body.action === "attention"
        ? await summariseManagementAttention(body.context as ExecutiveAiContext)
        : body.action === "snapshot"
          ? await generateProjectSnapshot(body.context as ExecutiveAiContext, body.projectName)
          : await rewriteExecutiveText(body.text, body.mode);

  // 200 even for a provider failure: this is an optional aid, and the caller
  // renders the message inline rather than treating it as a page error.
  return NextResponse.json(result);
}
