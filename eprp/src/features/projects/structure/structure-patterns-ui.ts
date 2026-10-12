import type { StructureLevelInput } from "@/types/project-structure";

/** Suggested structure levels only. No structure units or service calls. */
export const STRUCTURE_PATTERNS = [
  { id: "single", name: "Single level", labels: [["Function", "Functions"]] },
  { id: "function-workstream", name: "Function → Workstream", labels: [["Function", "Functions"], ["Workstream", "Workstreams"]] },
  { id: "area-function", name: "Area → Function", labels: [["Area", "Areas"], ["Function", "Functions"]] },
  { id: "package-workstream", name: "Package → Workstream", labels: [["Package", "Packages"], ["Workstream", "Workstreams"]] },
] as const;

export type StructurePresetId = typeof STRUCTURE_PATTERNS[number]["id"];

export function recognizeStructurePattern(levels: readonly StructureLevelInput[]): StructurePresetId | "custom" {
  return STRUCTURE_PATTERNS.find((pattern) => levels.length === pattern.labels.length
    && pattern.labels.every(([singular, plural], index) => {
      const level = levels.find((entry) => entry.levelNumber === index + 1);
      return level?.singularLabel === singular && level.pluralLabel === plural;
    }))?.id ?? "custom";
}

export function structurePatternName(levels: readonly StructureLevelInput[]): string {
  const id = recognizeStructurePattern(levels);
  return STRUCTURE_PATTERNS.find((pattern) => pattern.id === id)?.name ?? "Custom structure";
}

/** Retain each existing level's ID; newly appended levels have no fabricated ID. */
export function structurePatternDraft(levels: readonly StructureLevelInput[], id: StructurePresetId): StructureLevelInput[] {
  const pattern = STRUCTURE_PATTERNS.find((entry) => entry.id === id)!;
  return pattern.labels.map(([singularLabel, pluralLabel], index) => {
    const levelNumber = index + 1;
    const existing = levels.find((level) => level.levelNumber === levelNumber);
    return { ...(existing?.id ? { id: existing.id } : {}), levelNumber, singularLabel, pluralLabel };
  });
}

/** A level's position, named before the project gives it its own label. */
export function levelPositionName(number: number): string {
  return ["Top level", "Second level", "Third level", "Fourth level"][number - 1] ?? "Structure level";
}

/**
 * How a level relates to the one above it, for the level flow and the
 * Structure Hierarchy: "Top structural level" for Level 1, otherwise
 * "Reports under <the level above>". An unnamed draft level above falls
 * back to its number.
 */
export function levelRelation(
  levels: readonly Pick<StructureLevelInput, "levelNumber" | "singularLabel">[],
  levelNumber: number
): string {
  if (levelNumber <= 1) return "Top structural level";
  const above = levels.find((level) => level.levelNumber === levelNumber - 1);
  return `Reports under ${above?.singularLabel.trim() || `Level ${levelNumber - 1}`}`;
}
