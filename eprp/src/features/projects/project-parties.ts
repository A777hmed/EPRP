import type { ProjectParty } from "@/types";

/** The editable relation contains subcontractors only. Fixed parties are server-owned. */
export function subcontractorsForSave(parties: readonly ProjectParty[]): ProjectParty[] {
  if (parties.some((party) => !["eprom", "owner", "subcontractor"].includes(party.kind))) {
    throw new Error("Invalid project party type.");
  }
  const rows = parties.filter((party) => party.kind === "subcontractor");
  const ids = rows.flatMap((party) => party.id ? [party.id] : []);
  if (new Set(ids).size !== ids.length) throw new Error("A subcontractor cannot appear twice.");
  return rows.map((party, sortOrder) => {
    const name = party.name?.trim() ?? "";
    if (!name || name.length > 140) throw new Error("Enter a subcontractor name of up to 140 characters.");
    return { id: party.id || undefined, kind: "subcontractor", name, sortOrder };
  });
}

/** Mock persistence mirrors fixed identity, ordering and subcontractor replacement. */
export function persistProjectParties(
  existing: readonly ProjectParty[] | undefined,
  submitted: readonly ProjectParty[] | undefined,
  newId: () => string
): ProjectParty[] {
  const fixed = (["eprom", "owner"] as const).map((kind, sortOrder) => ({
    id: existing?.find((party) => party.kind === kind)?.id ?? newId(),
    kind,
    sortOrder,
  }));
  const rows = subcontractorsForSave(submitted ?? existing ?? []);
  for (const row of rows) {
    if (row.id && !existing?.some((party) => party.id === row.id && party.kind === "subcontractor")) {
      throw new Error("Subcontractor identity does not belong to this project. Reload before saving.");
    }
  }
  return [...fixed, ...rows.map((row) => ({ ...row, id: row.id ?? newId() }))];
}
