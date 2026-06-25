// Axis-aware decisions for the section-view correlation overlay
// (`CorrelationEdgesOverlay`) — extracted from SectionPanel so the gate + the
// edge-source selection are pure, importable, and unit-testable without
// mounting the god-component.
//
// The load-bearing rule these helpers encode (geotech Phase 1, 2026-06-25):
// the overlay mounts on the litho AND geotech axes, but the geotech overlay
// reads a SEPARATE geotech edge list (`geotechCorrelationEdges`). The
// litho-framed `contactEdges` list still drives the partition fill + the
// correlated-pair column spacing on BOTH axes and is NEVER repurposed for the
// geotech overlay — mixing the two pinched every litho band to a lens
// (regression fixed in commit 7329738b). `partitionEdgeSource` makes that
// invariant assertable: it returns `contactEdges` regardless of axis.

import type { LithoContactCorrelationEdge } from '../../api/client'

/** Section-view model axis (mirrors SectionPanel's `axisMode` prop). */
export type AxisMode = 'geological' | 'lithostratigraphic' | 'geotechnical'

/**
 * Whether the `CorrelationEdgesOverlay` should mount for this axis + gesture
 * state.
 *
 * Mounts on the litho AND geotech axes (the geotech axis hosts the "Correlate
 * packing" gesture surface + ribbons); absent on the geological axis so the
 * overlay never intercepts geological-axis interactions. Kept mounted while
 * correlate mode is on even if correlations are hidden — the overlay also hosts
 * the correlate-gesture hit-targets, so unmounting it would silently break
 * correlate clicks.
 *
 * Parameters
 * ----------
 * axisMode : AxisMode
 *     The active section-view model axis.
 * showCorrelations : boolean
 *     Whether the correlation overlay is toggled visible.
 * contactCorrelateMode : boolean | undefined
 *     Whether the boundary-click correlate gesture is armed.
 *
 * Returns
 * -------
 * boolean
 *     True when the overlay should be rendered.
 */
export function shouldMountCorrelationOverlay(
  axisMode: AxisMode,
  showCorrelations: boolean,
  contactCorrelateMode: boolean | undefined,
): boolean {
  const axisAllowed =
    axisMode === 'lithostratigraphic' || axisMode === 'geotechnical'
  return axisAllowed && Boolean(showCorrelations || contactCorrelateMode)
}

/**
 * The edge list the `CorrelationEdgesOverlay` renders as ribbons + right-click
 * targets for this axis.
 *
 * Geotech axis → the separate `geotechCorrelationEdges` (the geotech model's
 * packing edges); every other axis → the litho-framed `contactEdges`.
 *
 * Parameters
 * ----------
 * axisMode : AxisMode
 *     The active section-view model axis.
 * contactEdges : readonly LithoContactCorrelationEdge[] | undefined
 *     The litho-framed contact edges (also the partition-fill source).
 * geotechCorrelationEdges : readonly LithoContactCorrelationEdge[] | undefined
 *     The geotech model's packing edges (overlay ribbons on the geotech axis).
 *
 * Returns
 * -------
 * readonly LithoContactCorrelationEdge[]
 *     The edge list the overlay should draw.
 */
export function overlayEdgeSource(
  axisMode: AxisMode,
  contactEdges: readonly LithoContactCorrelationEdge[] | undefined,
  geotechCorrelationEdges: readonly LithoContactCorrelationEdge[] | undefined,
): readonly LithoContactCorrelationEdge[] {
  if (axisMode === 'geotechnical') return geotechCorrelationEdges ?? []
  return contactEdges ?? []
}

/**
 * The edge list that FRAMES the partition fill (`computeSectionFill`) + the
 * correlated-pair column spacing.
 *
 * This is ALWAYS `contactEdges` (the litho-framed list), on every axis — the
 * regression guard. The geotech overlay must never feed its edges here; doing
 * so pulled the litho connectivity out of the fill and pinched every band to a
 * lens (commit 7329738b). Exposed as a named helper so a test can assert the
 * partition source is axis-independent.
 *
 * Parameters
 * ----------
 * _axisMode : AxisMode
 *     The active axis — accepted only to make the axis-independence explicit
 *     at call sites + in tests; intentionally ignored.
 * contactEdges : readonly LithoContactCorrelationEdge[] | undefined
 *     The litho-framed contact edges.
 *
 * Returns
 * -------
 * readonly LithoContactCorrelationEdge[] | undefined
 *     `contactEdges`, unchanged by axis.
 */
export function partitionEdgeSource(
  _axisMode: AxisMode,
  contactEdges: readonly LithoContactCorrelationEdge[] | undefined,
): readonly LithoContactCorrelationEdge[] | undefined {
  return contactEdges
}
