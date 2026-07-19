"use client";

// Shares the interaction-machine actor from ViewerCanvas (which owns the
// commit implementation) down to the zone hosts — FloatingToolbar dispatches
// TEMPLATE_PICKED/UNDO/REDO, panels read state via useSelector. Mirrors the
// ViewerActionsProvider pattern one file over.

import { createContext, useContext } from "react";
import type { ActorRefFrom } from "xstate";

import type { interactionMachine } from "@/lib/viewer/interaction/machine";

export type InteractionActor = ActorRefFrom<typeof interactionMachine>;

const InteractionContext = createContext<InteractionActor | null>(null);

export const InteractionProvider = InteractionContext.Provider;

export function useInteractionActor(): InteractionActor {
  const ctx = useContext(InteractionContext);
  if (!ctx) {
    throw new Error("useInteractionActor must be used within an InteractionProvider");
  }
  return ctx;
}
