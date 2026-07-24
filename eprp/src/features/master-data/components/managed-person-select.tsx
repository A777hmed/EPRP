"use client";

import { ManagedSelect, type ManagedSelectProps } from "./managed-select";

export type ManagedPersonSelectProps = Omit<ManagedSelectProps, "kind">;

/**
 * Managed select over the shared People master data — used by every
 * responsibility field (manager, control manager, coordinator, client
 * representative, sponsor). One person pool, one management surface.
 */
export function ManagedPersonSelect(props: ManagedPersonSelectProps) {
  return <ManagedSelect kind="contact" {...props} />;
}
