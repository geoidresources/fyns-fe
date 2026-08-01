"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Confirmation gate for destructive actions (ORB-37). Built on the existing
// Radix dialog primitive (components/ui/dialog.tsx) rather than a new overlay —
// there was previously NO confirmation of any kind in the app, so every delete
// was a single unguarded click.
//
// Usage is the `useConfirm()` hook: the caller keeps its own click handler but
// routes it through `confirm({...})`, and renders `confirmDialog` somewhere in
// its tree. The dialog lives in the HOST's render output, not the trigger's, so
// a trigger that unmounts on click (e.g. the scene context menu, which closes
// itself) still gets a working confirmation.

export interface ConfirmRequest {
  title: string;
  /** Body copy. Say what will actually happen — especially anything that
   * cascades or cannot be undone. */
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button (default true — every current caller is a delete). */
  destructive?: boolean;
  /** Awaited: an async confirm keeps the dialog open with a spinner until it
   * settles, so the user is not left wondering whether the click landed. */
  onConfirm: () => void | Promise<void>;
}

function ConfirmDialog({
  request,
  onOpenChange,
}: {
  request: ConfirmRequest | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, setPending] = React.useState(false);

  const run = async () => {
    if (!request || pending) return;
    try {
      setPending(true);
      await request.onConfirm();
    } finally {
      // Failures surface through the caller's own toast; the dialog always
      // closes so it can never wedge shut on a rejected promise.
      setPending(false);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !pending && onOpenChange(open)}>
      {request && (
        <DialogContent
          // Radix autofocuses the first focusable child; Cancel is first in DOM
          // order below, so Enter on an unread dialog cancels rather than deletes.
          onEscapeKeyDown={(e) => pending && e.preventDefault()}
          onInteractOutside={(e) => pending && e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{request.title}</DialogTitle>
            <DialogDescription>{request.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {request.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              variant={request.destructive === false ? "primary" : "destructive"}
              size="sm"
              disabled={pending}
              onClick={() => void run()}
            >
              {pending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
              {request.confirmLabel ?? "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

/** Owns the pending-confirmation state and the dialog element. Render
 * `confirmDialog` in the host component; call `confirm(request)` from the
 * destructive handler instead of performing the action directly. */
export function useConfirm(): {
  confirm: (request: ConfirmRequest) => void;
  confirmDialog: React.ReactElement;
} {
  const [request, setRequest] = React.useState<ConfirmRequest | null>(null);
  const confirm = React.useCallback((next: ConfirmRequest) => setRequest(next), []);
  const confirmDialog = (
    <ConfirmDialog
      request={request}
      onOpenChange={(open) => {
        if (!open) setRequest(null);
      }}
    />
  );
  return { confirm, confirmDialog };
}
