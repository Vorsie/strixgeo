// The 3-D viewer's split-viewport state machine.
//
// The viewer has two side-by-side modes and they mean different things:
//
//   'split'   CUT — one model, halved by a user-drawn vertical plane; the left
//             pane keeps one side, the right pane the other. Shipped
//             2026-06-01 (debt #64 as originally written) and unchanged here.
//   'compare' COMPARE — two DIFFERENT models, whole, at one viewpoint. The
//             litho model on the left and the geotech subdivision derived from
//             it on the right is the question the geotech stage exists to
//             answer, and it cannot be answered by flipping between stages:
//             the eye cannot hold a 3-D shape across a stage switch.
//
// Splitting the transitions out of ``useBody3DViewState`` is not ceremony. The
// three fields (mode / plane / line) were three independent ``useState``s, and
// a fourth mode over three independent setters is exactly where "compare left
// a stale cut plane behind" lives — the bug that would show the user half a
// model on each side and let them read the missing half as a modelling gap.
// One value, one transition per verb, and that state is unrepresentable.
//
// Deliberately generic over the plane / line types: the reducer never inspects
// them, so it carries no ``cesium`` import and its tests need no Cesium mock.

import type { GeologicalFormationResponse } from '../../../api/client'
import type { LithoBodySolidResponse } from '../../../api/clients/geology'
import type { FencePanel } from '../../../utils/fencePanels'

/** Operational mode of the viewer. */
export type SplitMode = 'single' | 'split' | 'compare'

/** The viewer's complete split state — one value, never three loose fields. */
export interface SplitViewportState<TPlane, TLine> {
  /** Which of the three layouts is on screen. */
  mode: SplitMode
  /** The cut plane, in ``'split'`` mode only; ``null`` otherwise. */
  plane: TPlane | null
  /** The drawn cut line, in ``'split'`` mode only; ``null`` otherwise. */
  line: TLine | null
}

/**
 * The resting state: one viewport, whole model, no cut.
 *
 * Frozen and module-level so an ``exitSplit`` in a dependency array does not
 * change identity between renders.
 */
export const SINGLE_VIEWPORT: SplitViewportState<never, never> = Object.freeze({
  mode: 'single' as const,
  plane: null,
  line: null,
})

/**
 * The state after the user completes the two-click cut-line draw.
 *
 * Parameters
 * ----------
 * _prev
 *     The state being replaced. Unused: drawing a cut line states the intent
 *     "cut THIS model" outright, so it supersedes a comparison rather than
 *     composing with it (a cut applied across two different models would clip
 *     each against a plane drawn on the other).
 * plane
 *     The ECEF cut plane.
 * line
 *     The drawn segment in projected CRS, echoed back for the cut-face caps.
 *
 * Returns
 * -------
 * SplitViewportState
 *     ``'split'`` mode carrying the plane and line.
 */
export function splitAfterCutDrawn<TPlane, TLine>(
  _prev: SplitViewportState<TPlane, TLine>,
  plane: TPlane,
  line: TLine,
): SplitViewportState<TPlane, TLine> {
  return { mode: 'split', plane, line }
}

/**
 * The state after the user asks to compare against the counterpart model.
 *
 * Parameters
 * ----------
 * _prev
 *     The state being replaced. Unused, and that is the point: any cut plane
 *     is DROPPED. Comparing two models through a clip would show half of each,
 *     and a half-model reads as a modelling gap rather than as a clip.
 *
 * Returns
 * -------
 * SplitViewportState
 *     ``'compare'`` mode with no cut.
 */
export function splitAfterCompare<TPlane, TLine>(
  _prev: SplitViewportState<TPlane, TLine>,
): SplitViewportState<TPlane, TLine> {
  return { mode: 'compare', plane: null, line: null }
}

/**
 * The state after the user collapses back to one viewport.
 *
 * One verb closes both modes — the "Single view" button in the viewer and the
 * stage toolbar's Reset both land here, so the user never has to know which
 * kind of split is open to get out of it.
 *
 * Parameters
 * ----------
 * _prev
 *     The state being replaced; unused.
 *
 * Returns
 * -------
 * SplitViewportState
 *     ``SINGLE_VIEWPORT``.
 */
export function splitAfterExit<TPlane, TLine>(
  _prev: SplitViewportState<TPlane, TLine>,
): SplitViewportState<TPlane, TLine> {
  return SINGLE_VIEWPORT as SplitViewportState<TPlane, TLine>
}

/**
 * The counterpart model rendered in the right-hand pane of a comparison.
 *
 * Assembled by the stage canvas from the shell bus — the litho and geotech
 * models both already live there, so a comparison costs no extra fetch.
 */
export interface CompareScene {
  /** Human-readable name of the model, shown as the pane's caption. */
  label: string
  /** The counterpart model's formations, already presentation-coloured. */
  formations: GeologicalFormationResponse[]
  /** The counterpart model's built body solids (Solid view). */
  bodySolids?: LithoBodySolidResponse[]
  /** The counterpart model's fence walls (Fence view). */
  fencePanels?: FencePanel[]
}

/**
 * Whether a comparison against this scene is worth offering.
 *
 * Parameters
 * ----------
 * scene
 *     The counterpart scene, or ``null`` / ``undefined`` when the stage has no
 *     counterpart at all.
 *
 * Returns
 * -------
 * boolean
 *     True only when the counterpart would actually paint something. An empty
 *     ``bodySolids`` array is not enough, and neither is an array whose entries
 *     all carry zero vertices — a flagged slab is persisted with an empty mesh,
 *     so "has rows" and "has geometry" are genuinely different questions. A
 *     Compare button that opens a blank pane reads as a broken viewer, which is
 *     a worse outcome than a disabled button explaining itself.
 */
export function canCompare(scene: CompareScene | null | undefined): boolean {
  if (!scene) return false
  const hasSolid = (scene.bodySolids ?? []).some(s => s.vertices.length > 0)
  const hasWall = (scene.fencePanels ?? []).some(p => p.vertices.length > 0)
  return hasSolid || hasWall
}
