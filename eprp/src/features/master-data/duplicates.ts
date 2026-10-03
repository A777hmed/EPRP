/**
 * The one duplicate rule for master-data names and codes, shared by the
 * in-memory and Supabase services so both refuse the same inputs.
 *
 * Values are compared normalized: trimmed, inner whitespace collapsed,
 * case-insensitive — "Inspection  program " duplicates "Inspection Program".
 * Existing rows are never merged or changed by this; it only refuses a NEW
 * (or edited) value that would collide with another record.
 *
 * Pure: no imports, so it can be exercised directly in tests.
 */

export function normalizeMasterValue(value: string | undefined | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export interface DuplicateCandidate {
  id: string;
  name: string;
  code?: string | null;
}

/**
 * Which field of `input` collides with another record, if any. Only keys the
 * caller actually supplied are checked (a partial update that omits `name`
 * is not checked against names), and the record being edited is skipped.
 * Name is reported before code.
 */
export function duplicateFieldOf(
  input: { name?: string | null; code?: string | null },
  records: Iterable<DuplicateCandidate>,
  excludeId?: string
): "name" | "code" | undefined {
  const name = "name" in input ? normalizeMasterValue(input.name) : "";
  const code = "code" in input ? normalizeMasterValue(input.code) : "";
  if (!name && !code) return undefined;

  let codeClash = false;
  for (const record of records) {
    if (record.id === excludeId) continue;
    if (name && normalizeMasterValue(record.name) === name) return "name";
    if (code && normalizeMasterValue(record.code) === code) codeClash = true;
  }
  return codeClash ? "code" : undefined;
}
