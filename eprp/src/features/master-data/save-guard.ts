/**
 * A caller-supplied check that runs BEFORE a master-data record is created.
 *
 * Some places that offer inline "Add" have a rule the generic form does not
 * know — e.g. the Project Category picker of an Other project must not create
 * a PSM / PSAIM-family category. The guard lets that context refuse the save
 * outright, so no row is inserted and then rejected afterwards.
 *
 * Standalone Master Data management passes no guard and is unaffected.
 *
 * Pure: no imports, so it can be exercised directly in tests.
 */

export interface MasterSaveRefusal {
  /** The form field the message belongs under, e.g. "code" or "name". */
  field: string;
  message: string;
}

export type MasterCreateGuard = (
  input: Record<string, unknown>
) => MasterSaveRefusal | undefined;

/**
 * Run the save unless the guard refuses it. The guard applies to CREATE only:
 * editing an existing record is never blocked by it. When refused, `save` is
 * not called at all.
 */
export async function saveWithCreateGuard<T>(args: {
  mode: "create" | "edit";
  input: Record<string, unknown>;
  guard?: MasterCreateGuard;
  save: () => Promise<T>;
}): Promise<{ saved: T } | { refused: MasterSaveRefusal }> {
  if (args.mode === "create" && args.guard) {
    const refused = args.guard(args.input);
    if (refused) return { refused };
  }
  return { saved: await args.save() };
}
