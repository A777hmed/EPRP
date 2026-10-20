import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// Phase 13.9B — browser UAT fixes for the approval UX:
//   1. Withdraw is offered only to the requester of a pending request.
//   2. After an amendment decision the Project Info values (and planning mode)
//      refresh without a browser reload.
// The database stays authoritative; these are presentation / refresh contracts.

registerHooks({ load(url, context, nextLoad) {
  if (!(url.includes("/eprp/src/") && url.endsWith(".ts"))) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });

const amendments = await import("./setup-amendments.ts");

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");

test("Withdraw is offered only to the requester of a pending request", () => {
  const open = { projectArchived: false };
  const pending = { status: "pending", requestedBy: "requester-1" };
  const requester = { profileId: "requester-1", isGlobalAuthority: false };
  const requesterAdmin = { profileId: "requester-1", isGlobalAuthority: true };
  const otherPca = { profileId: "pca-2", isGlobalAuthority: true };
  const otherSa = { profileId: "sa-3", isGlobalAuthority: true };
  const anonymous = { profileId: "", isGlobalAuthority: true };

  assert.equal(amendments.canWithdrawAmendment(pending, requester, open), true);
  assert.equal(amendments.canWithdrawAmendment(pending, requesterAdmin, open), true);
  // An approver who is not the requester sees Approve / Reject, never Withdraw.
  assert.equal(amendments.canWithdrawAmendment(pending, otherPca, open), false);
  assert.equal(amendments.canWithdrawAmendment(pending, otherSa, open), false);
  assert.equal(amendments.canWithdrawAmendment(pending, anonymous, open), false);
  // Only while pending, and never on an archived project.
  for (const status of ["approved", "rejected", "withdrawn", "stale"]) {
    assert.equal(amendments.canWithdrawAmendment({ ...pending, status }, requester, open), false, status);
  }
  assert.equal(amendments.canWithdrawAmendment(pending, requester, { projectArchived: true }), false);
  // Deciding is unchanged: the requester never decides; another admin does.
  assert.equal(amendments.canDecideAmendment(pending, otherPca, open), true);
  assert.equal(amendments.canDecideAmendment(pending, requesterAdmin, open), false);
  // The panel's Withdraw button is gated by exactly this helper.
  const panel = code("./components/governance/setup-amendments-panel.tsx");
  assert.match(panel, /canWithdrawAmendment\(amendment, viewer, \{ projectArchived \}\)/);
  assert.match(panel, /\{canWithdraw && \(\s*<Button size="sm" variant="ghost" onClick=\{\(\) => setWithdrawOpen\(true\)\}/);
});

test("after a decision the Project Info values, planning mode and panels refresh without a browser reload", () => {
  const view = code("./components/setup/project-setup-view.tsx");
  // The panel's change callback reloads amendments + project and bumps the revision.
  assert.match(view, /onChanged=\{\(\) => \{\s*governanceState\.reload\(\);\s*reloadProject\(\);\s*setDecisionRevision\(\(revision\) => revision \+ 1\);\s*\}\}/);
  assert.match(view, /pending: pendingByField,\s*decisionRevision,/);
  // The structure panels use the same reload path (Step 4 unchanged).
  assert.match(view, /const afterGovernanceChange = \(\) => \{\s*governance\.reload\(\);\s*onProjectChanged\(\);/);

  const form = code("./components/project-form.tsx");
  // A controlled field adopts the newer stored value unless it has an unsaved edit.
  assert.match(form, /const governedSnapshot = JSON\.stringify\(\s*Object\.values\(SETUP_FIELD_UI\)\.flatMap/);
  assert.match(form, /if \(form\.getFieldState\(key\)\.isDirty\) continue;/);
  assert.match(form, /form\.resetField\(key, \{ defaultValue: stored as never \}\);/);
  assert.match(form, /\}, \[controlledNow, governedSnapshot\]\);/);
  // The planning mode (stored outside the project row) is re-read after a decision.
  assert.match(form, /\}, \[projectId, decisionRevision\]\);/);
});
