/** Thrown by service stubs until database integration lands (Phase 5+). */
export class NotImplementedError extends Error {
  constructor(method: string) {
    super(
      `${method} is not implemented yet — database integration arrives in a later phase.`
    );
    this.name = "NotImplementedError";
  }
}

/** Builds a stub method that throws a clear NotImplementedError. */
export function notImplemented(method: string): (...args: never[]) => never {
  return () => {
    throw new NotImplementedError(method);
  };
}
