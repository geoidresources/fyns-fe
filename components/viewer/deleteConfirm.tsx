"use client";

import type { ConfirmRequest } from "@/components/ui/confirm-dialog";

// Shared copy for the three measurement-delete affordances (ORB-37): the
// inspector's Delete row, the workspace tree's hover trash icon, and the scene
// right-click menu. They are the same destructive action, so they get the same
// wording — the dialog is the only thing standing between a stray click and a
// permanent delete, and inconsistent copy is what trains people to dismiss it.

/** Confirmation request for deleting (or discarding) one measurement. */
export function measurementDeleteRequest(
  measurement: { name: string; draft?: boolean },
  onConfirm: () => void | Promise<void>
): ConfirmRequest {
  const isDraft = measurement.draft === true;
  const name = <span className="text-gray-300">{measurement.name}</span>;
  return {
    title: isDraft ? "Discard this draft?" : "Delete this measurement?",
    description: isDraft ? (
      <>
        {name} has not been saved. Discarding it removes the shape and anything computed for it.
        This cannot be undone.
      </>
    ) : (
      <>
        {name} and its computed results will be permanently deleted. This cannot be undone.
      </>
    ),
    confirmLabel: isDraft ? "Discard draft" : "Delete",
    onConfirm,
  };
}
