// Pure decision for the Geology canvas empty-state (debt #33).
//
// Extracted from GeologyCanvas so it is unit-testable WITHOUT mounting
// Cesium (the canvas imports the 3D viewer at module load, which needs
// WebGL — see debt #41). The component keeps the rendering; this owns
// the "what should the empty state say / offer" logic.

export interface GeologyEmptyState {
  /** Guidance sentence shown under the icon. */
  guidance: string
  /** Whether to render the "Add formation" CTA button. */
  showAddFormation: boolean
}

/**
 * Decide the Geology canvas empty-state copy + CTA.
 *
 * Three cases (debt #33 — a CPT-only project must not dead-end at the
 * disabled "Fill from boreholes" button):
 *
 * - formations exist            → prompt to Build the 3D model.
 * - no formations, boreholes    → Fill-from-boreholes is the fast path,
 *                                 manual add is the fallback.
 * - no formations, no boreholes → Fill is permanently disabled; manual
 *                                 add is the ONLY path, so surface it.
 *
 * The CTA shows whenever there are no formations (both no-formation
 * cases), because manual creation is always valid and the canvas
 * should never point at a button the user can't reach.
 *
 * Parameters
 * ----------
 * hasFormations
 *     Whether the active model has at least one formation.
 * hasBoreholes
 *     Whether the project has at least one visible borehole.
 *
 * Returns
 * -------
 * GeologyEmptyState
 *     The guidance sentence + whether to show the Add-formation CTA.
 */
export function geologyEmptyState(
  hasFormations: boolean,
  hasBoreholes: boolean,
): GeologyEmptyState {
  if (hasFormations) {
    return {
      guidance: 'No 3D model yet — build it from the stratigraphy.',
      showAddFormation: false,
    }
  }
  if (hasBoreholes) {
    return {
      guidance:
        'No formations yet. Use "Fill from boreholes" in the toolbar to ' +
        'seed them from borehole stratigraphy, or add one manually.',
      showAddFormation: true,
    }
  }
  return {
    guidance:
      'No formations yet. This project has no boreholes to fill from — ' +
      'add a formation manually to start the model.',
    showAddFormation: true,
  }
}
