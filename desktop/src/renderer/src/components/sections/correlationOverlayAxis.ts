// Axis-aware decisions for the section-view correlation overlay
// (`CorrelationEdgesOverlay`) — extracted from SectionPanel so the gate + the
// edge-source selection are pure, importable, and unit-testable without
// mounting the god-component.
//
// The load-bearing rules these helpers encode:
//
//  1. (geotech Phase 1, 2026-06-25) the overlay mounts on the litho AND geotech
//     axes, and the geotech overlay reads a SEPARATE geotech edge list
//     (`geotechCorrelationEdges`).
//  2. (owner ruling 2026-08-13) the geotech axis's PARTITION is the geotech
//     model's own — same engine, geotech columns, geotech ties: "we don't need
//     to invent the fill bands engine, it is built for the litho stage — we
//     only have more classes". `partitionEdgeSource` and `partitionLayerSource`
//     therefore move TOGETHER: whichever model frames the edges also supplies
//     the layers the columns are assembled from.
//
// Rule 2 supersedes the 2026-06-25 axis-independence guard (commit 7329738b),
// which forced the partition to read `contactEdges` on every axis. That guard
// existed because the geotech edges were being fed to a partition assembled
// from LITHO layers — a layer/edge MISMATCH that pinched every litho band to a
// lens. Keeping the two sources in lockstep removes the mismatch by
// construction, so the guard's premise no longer holds.

import type { LithoContactCorrelationEdge, LithoLayerResponse } from '../../api/client'

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
 * Whether the partition on this axis is framed by the GEOTECH model.
 *
 * One place answers it so the edge source and the layer source can never
 * disagree — a layer/edge mismatch is precisely the fault the retired
 * 7329738b guard was built around.
 *
 * @param axisMode The active section-view model axis.
 * @param showLithoFillInstead The geotech "Show litho fill" toggle: when on,
 *   the geotech axis paints the LITHO partition instead (one fill at a time).
 * @returns True when the geotech model frames the partition.
 */
function partitionsGeotechModel(axisMode: AxisMode, showLithoFillInstead: boolean): boolean {
  return axisMode === 'geotechnical' && !showLithoFillInstead
}

/**
 * The edge list that FRAMES the partition fill (`computeSectionFill`).
 *
 * Geotech axis → the geotech model's packing ties (the SAME approved set the
 * 3-D build arm consumes, so one hand correlation moves render and build
 * together); every other axis → the litho-framed `contactEdges`.
 *
 * Note this does NOT drive the correlated-pair column spacing, which reads
 * `contactEdges` directly at its own call site and stays litho-framed on every
 * axis — the columns must not shift when the fill's source changes.
 *
 * Parameters
 * ----------
 * axisMode : AxisMode
 *     The active section-view model axis.
 * contactEdges : readonly LithoContactCorrelationEdge[] | undefined
 *     The litho model's contact edges.
 * geotechCorrelationEdges : readonly LithoContactCorrelationEdge[] | undefined
 *     The geotech model's packing edges.
 * showLithoFillInstead : boolean
 *     The geotech "Show litho fill" toggle (defaults false).
 *
 * Returns
 * -------
 * readonly LithoContactCorrelationEdge[] | undefined
 *     The edge list the partition should be framed by. On the geotech axis an
 *     absent geotech list yields `[]`, never the litho list — a section with no
 *     packing model must paint nothing, not the litho fill (dogfeed 2026-08-06).
 */
export function partitionEdgeSource(
  axisMode: AxisMode,
  contactEdges: readonly LithoContactCorrelationEdge[] | undefined,
  geotechCorrelationEdges: readonly LithoContactCorrelationEdge[] | undefined,
  showLithoFillInstead = false,
): readonly LithoContactCorrelationEdge[] | undefined {
  if (partitionsGeotechModel(axisMode, showLithoFillInstead)) return geotechCorrelationEdges ?? []
  return contactEdges
}

/**
 * The layer list the partition's COLUMNS are assembled from.
 *
 * The sibling of {@link partitionEdgeSource} — the correlation edges reference
 * layer ids, so the two must always name the same model. Geotech axis → the
 * geotech model's packing bands; every other axis → the litho model's layers.
 *
 * Parameters
 * ----------
 * axisMode : AxisMode
 *     The active section-view model axis.
 * lithoLayers : readonly LithoLayerResponse[] | undefined
 *     The litho model's layer rows.
 * geotechLayers : readonly LithoLayerResponse[] | undefined
 *     The geotech model's packing-band rows (same row shape, sibling model).
 * showLithoFillInstead : boolean
 *     The geotech "Show litho fill" toggle (defaults false).
 *
 * Returns
 * -------
 * readonly LithoLayerResponse[]
 *     The layers to assemble columns from; `[]` when the chosen model has none.
 */
export function partitionLayerSource(
  axisMode: AxisMode,
  lithoLayers: readonly LithoLayerResponse[] | undefined,
  geotechLayers: readonly LithoLayerResponse[] | undefined,
  showLithoFillInstead = false,
): readonly LithoLayerResponse[] {
  if (partitionsGeotechModel(axisMode, showLithoFillInstead)) return geotechLayers ?? []
  return lithoLayers ?? []
}

/**
 * The formation → colour map for the partition the overlay is about to paint.
 *
 * Third sibling of the two above, for the same reason: a palette keyed by the
 * WRONG model resolves nothing. ``formationColorById`` is built from the AXIS's
 * formations — geotech (NAD colours) on the geotech axis — so when "Show litho
 * fill" swaps the partition back to the litho model, its regions carry litho
 * formation ids that map has never heard of, and every one of them falls back
 * to the neutral grey. The palette has to travel with the model.
 *
 * Parameters
 * ----------
 * axisMode : AxisMode
 *     The active section-view model axis.
 * formationColorById : ReadonlyMap<string, string>
 *     The axis's own palette (NAD colours on the geotech axis).
 * lithoFormationColorById : ReadonlyMap<string, string> | undefined
 *     Litho formation id → lithology colour. Absent (no geotech model loaded)
 *     leaves the axis palette in place rather than blanking the fill.
 * showLithoFillInstead : boolean
 *     The geotech "Show litho fill" toggle (defaults false).
 *
 * Returns
 * -------
 * ReadonlyMap<string, string>
 *     The palette matching whichever model frames the partition.
 */
export function partitionColorSource(
  axisMode: AxisMode,
  formationColorById: ReadonlyMap<string, string>,
  lithoFormationColorById: ReadonlyMap<string, string> | undefined,
  showLithoFillInstead = false,
): ReadonlyMap<string, string> {
  if (axisMode === 'geotechnical' && showLithoFillInstead && lithoFormationColorById) {
    return lithoFormationColorById
  }
  return formationColorById
}
