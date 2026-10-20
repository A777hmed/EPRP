"use client";

import * as React from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { useCurrentIdentity } from "@/features/auth/use-current-identity";
import { setupFieldEntry } from "@/features/projects/setup-governance";
import {
  describeStructureChange,
  isStructureAmendment,
  structureAmendmentStep,
} from "@/features/projects/structure-amendments";
import { projectWorkflowHref } from "@/config/project-workflow";
import { formatDateTime } from "@/lib/formatters";
import {
  setupGovernanceService,
  type ActionableAmendment,
} from "@/services/setup-governance-service";

/**
 * Phase 13.9B — Project Setup amendments awaiting the signed-in approver,
 * across projects. Shown to Project Control Admins and System
 * Administrators only; each item opens that project's Project Setup, where
 * the request is approved or rejected (the existing per-project surface) —
 * a structure request opens the step that shows its target (Step 4).
 * Never the approver's own requests; never an archived project's.
 */
export function SetupAmendmentQueue() {
  const identity = useCurrentIdentity();
  const [items, setItems] = React.useState<ActionableAmendment[] | null>(null);
  const eligible = identity.resolved && identity.isGlobalAuthority && Boolean(identity.profileId);

  React.useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    setupGovernanceService
      .listActionableApprovals(identity.profileId)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [eligible, identity.profileId]);

  if (!eligible || items === null) return null;

  return (
    <section className="dash-panel dash-queue" aria-label="Setup amendments awaiting your decision">
      <header>
        <div>
          <b>Setup Amendments{items.length > 0 ? ` (${items.length})` : ""}</b>
        </div>
      </header>
      <div className="dash-panel-body">
        {items.length === 0 ? (
          <p className="dash-note is-clear">No Project Setup amendments are waiting for your decision.</p>
        ) : (
          <ul className="dash-items">
            {items.slice(0, 5).map(({ amendment, project }) => (
              <li key={amendment.id}>
                <Link
                  href={projectWorkflowHref(
                    project.id,
                    (isStructureAmendment(amendment) && structureAmendmentStep(amendment.fieldKey)) || "info"
                  )}
                >
                  <ShieldCheck className="dash-item-icon is-warning" aria-hidden />
                  <span>
                    <b>
                      {project.code} ·{" "}
                      {isStructureAmendment(amendment)
                        ? describeStructureChange(amendment).title
                        : (setupFieldEntry(amendment.fieldKey)?.label ?? "Setup field")}
                    </b>
                    <small>
                      {amendment.requestedByName ?? "Project Control"} · {formatDateTime(amendment.requestedAt)}
                    </small>
                  </span>
                  <em className="is-warning">Review</em>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
