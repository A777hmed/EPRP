"use client";

/**
 * The Executive AI assist controls.
 *
 * Deliberately not a chatbot. Two quiet buttons beside the Executive Summary,
 * and when a draft comes back, an editable box with four plain choices. The
 * report remains the interface.
 *
 * NOTHING here writes to the report on its own. A draft is proposed; only the
 * text the user accepts is used, and the user can edit it first. There is no
 * path from generation to approval or publication.
 */

import * as React from "react";
import { Check, RotateCw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ExecutiveDocumentModel } from "./executive-document";
import { buildAiContext, type RewriteMode } from "./executive-ai-context";

const REWRITE_MODES: [RewriteMode, string][] = [
  ["improve", "Improve Writing"],
  ["professional", "Make More Professional"],
  ["executive", "Make More Executive"],
  ["concise", "Make More Concise"],
  ["summarize", "Summarize"],
  ["expand", "Expand Clearly"],
  ["grammar", "Correct Grammar"],
  ["simplify", "Simplify Wording"],
];

interface AiState {
  status: "idle" | "working" | "draft";
  text: string;
  message?: string;
}

export function ExecutiveAiPanel({
  model,
  currentText,
  onAccept,
}: {
  model: ExecutiveDocumentModel;
  /** The summary as it currently reads — the input for a rewrite. */
  currentText: string;
  onAccept: (text: string) => void;
}) {
  const [available, setAvailable] = React.useState<boolean | null>(null);
  const [state, setState] = React.useState<AiState>({ status: "idle", text: "" });
  const [lastAction, setLastAction] = React.useState<{ kind: "summary" } | { kind: "rewrite"; mode: RewriteMode }>({
    kind: "summary",
  });

  /*
   * Ask the server whether a provider is configured. The answer decides whether
   * the controls appear at all — offering a button that always fails is worse
   * than offering nothing.
   */
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/executive/ai")
      .then((response) => (response.ok ? response.json() : { available: false }))
      .then((payload: { available?: boolean }) => {
        if (!cancelled) setAvailable(Boolean(payload.available));
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = React.useCallback(
    async (action: { kind: "summary" } | { kind: "rewrite"; mode: RewriteMode }) => {
      setLastAction(action);
      setState({ status: "working", text: "" });

      const body =
        action.kind === "summary"
          ? { action: "summary", context: buildAiContext(model) }
          : { action: "rewrite", text: currentText, mode: action.mode };

      try {
        const response = await fetch("/api/executive/ai", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as
          | { ok: true; text: string }
          | { ok: false; available: boolean; message: string };

        if (!payload.ok) {
          setState({ status: "idle", text: "", message: payload.message });
          if (!payload.available) setAvailable(false);
          return;
        }
        setState({ status: "draft", text: payload.text });
      } catch {
        setState({
          status: "idle",
          text: "",
          message: "The AI assistant could not be reached. The report is unaffected.",
        });
      }
    },
    [model, currentText]
  );

  /*
   * The controls are ALWAYS rendered, even unconfigured.
   *
   * Hiding them made the capability invisible and left a reader unable to tell
   * "this build has no AI" from "the button is somewhere else". They are shown
   * disabled with a plain reason instead.
   */
  const unconfigured = available === false;
  const probing = available === null;
  const busy = state.status === "working";

  return (
    <div className="exec-ai print:hidden">
      <div className="exec-ai-actions">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void run({ kind: "summary" })}
          disabled={busy || unconfigured || probing}
          title={unconfigured ? "AI is not configured" : undefined}
        >
          <Sparkles />
          {busy && lastAction.kind === "summary" ? "Drafting…" : "Draft with AI"}
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={() => void run({ kind: "rewrite", mode: "improve" })}
          disabled={busy || unconfigured || probing || !currentText.trim()}
          title={unconfigured ? "AI is not configured" : undefined}
        >
          <Wand2 />
          {busy && lastAction.kind === "rewrite" ? "Rewriting…" : "Improve Writing"}
        </Button>

        <label className="exec-ai-rewrite">
          <select
            aria-label="More rewrite options"
            value=""
            disabled={busy || unconfigured || probing || !currentText.trim()}
            onChange={(event) => {
              const mode = event.target.value as RewriteMode;
              if (mode) void run({ kind: "rewrite", mode });
            }}
          >
            <option value="">More…</option>
            {REWRITE_MODES.map(([mode, label]) => (
              <option key={mode} value={mode}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {unconfigured ? (
          <span className="exec-ai-unconfigured">AI is not configured</span>
        ) : (
          <span className="exec-ai-hint">
            Drafting aid — figures always come from the report, never from the assistant.
          </span>
        )}
      </div>

      {state.message && <p className="exec-ai-error">{state.message}</p>}

      {state.status === "draft" && (
        <div className="exec-ai-draft">
          <div className="exec-ai-draft-head">
            <b>AI-generated draft — review before use</b>
            <span>Editable. Nothing is applied to the report until you accept it.</span>
          </div>
          <textarea
            rows={8}
            value={state.text}
            aria-label="AI-generated draft"
            onChange={(event) => setState({ ...state, text: event.target.value })}
          />
          <div className="exec-ai-draft-actions">
            <Button
              size="sm"
              onClick={() => {
                onAccept(state.text.trim());
                setState({ status: "idle", text: "" });
                toast.success("Draft accepted into the Executive Summary for this session.");
              }}
              disabled={!state.text.trim()}
            >
              <Check />
              Accept
            </Button>
            <Button size="sm" variant="outline" onClick={() => void run(lastAction)}>
              <RotateCw />
              Regenerate
            </Button>
            <Button size="sm" variant="outline" onClick={() => setState({ status: "idle", text: "" })}>
              <Trash2 />
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
