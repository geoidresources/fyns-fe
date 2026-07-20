// Migration seam (plan §P0). ALWAYS ON as of P3-scoped: the legacy draw/edit path
// was deleted (FloatingToolbarLegacy + startDraw + the edit callbacks), so v2 is
// the only functional interaction layer — the env toggle is retired (turning it
// "off" would leave the V2 toolbar with no adapter = no drawing). The const stays
// so the remaining `if (INTERACTION_V2)` conditionals compile + resolve to v2
// (P3-full unwinds them + this flag). Probe/point still ride the legacy startProbe.
export const INTERACTION_V2 = true;
