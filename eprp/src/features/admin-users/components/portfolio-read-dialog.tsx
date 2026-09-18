"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PORTFOLIO_READ_HELP_TEXT } from "../copy";
import { setPortfolioReadGrant, type PortfolioReadTier } from "../actions";
import type { UserRow } from "../types";

export interface PortfolioReadDialogProps {
  row: UserRow;
  onClose: () => void;
  onSaved: () => void;
}

const TIER_LABELS: Record<Exclude<PortfolioReadTier, null>, string> = {
  full: "Full Portfolio Read",
  published: "Published Portfolio Read",
};

/**
 * Grant or revoke one account's portfolio-read tier.
 *
 * Deliberately its own dialog, not a field on the Edit User form: platform
 * role, project responsibility and this entitlement are three separate
 * concepts (`docs/` Phase B), and keeping the control physically separate
 * makes that visible rather than implying they are one setting with three
 * options.
 *
 * The visible choice is "None / Full / Published" — never job title, never a
 * project or department picker. `setPortfolioReadGrant()` re-verifies System
 * Administrator server-side before writing, and the table's own RLS
 * (`is_system_admin()` on insert/update) refuses the write independently if
 * that check were ever bypassed.
 */
export function PortfolioReadDialog({
  row,
  onClose,
  onSaved,
}: PortfolioReadDialogProps) {
  const [tier, setTier] = React.useState<PortfolioReadTier>(
    row.portfolioReadTier
  );
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await setPortfolioReadGrant(row.profileId, tier);
      onSaved();
      toast.success(
        tier
          ? `Portfolio read set to ${TIER_LABELS[tier]}.`
          : "Portfolio read access removed."
      );
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update portfolio read access."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Portfolio Read Access</DialogTitle>
          <DialogDescription>
            {row.personName ?? row.loginEmail} — {PORTFOLIO_READ_HELP_TEXT}
          </DialogDescription>
        </DialogHeader>

        <Select
          value={tier ?? "none"}
          onValueChange={(value) =>
            setTier(value === "none" ? null : (value as PortfolioReadTier))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="full">Full Portfolio Read</SelectItem>
            <SelectItem value="published">Published Portfolio Read</SelectItem>
          </SelectContent>
        </Select>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
