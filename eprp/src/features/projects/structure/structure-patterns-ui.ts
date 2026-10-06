import type { StructureLevelInput } from "@/types/project-structure";

/** Suggested hierarchy types only. No project groups or service calls. */
export const STRUCTURE_PATTERNS = [
  { id: "single", name: "Single grouping", labels: [["Function", "Functions"]] },
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

/** Retain each existing layer's ID; newly appended layers have no fabricated ID. */
export function structurePatternDraft(levels: readonly StructureLevelInput[], id: StructurePresetId): StructureLevelInput[] {
  const pattern = STRUCTURE_PATTERNS.find((entry) => entry.id === id)!;
  return pattern.labels.map(([singularLabel, pluralLabel], index) => {
    const levelNumber = index + 1;
    const existing = levels.find((level) => level.levelNumber === levelNumber);
    return { ...(existing?.id ? { id: existing.id } : {}), levelNumber, singularLabel, pluralLabel };
  });
}

export function hierarchyLayerName(number: number): string {
  return ["Main project group", "Sub-group", "Third layer", "Fourth layer"][number - 1] ?? "Project group";
}
