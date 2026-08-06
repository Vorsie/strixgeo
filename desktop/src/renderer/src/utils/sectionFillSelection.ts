/**
 * The section view's fill-selection rule — which fill paints, if any.
 *
 * Owner directive (dogfeed 2026-08-06): on the geotech axis only ONE fill may
 * render at a time, and the litho fill is opt-in there. Before this rule the
 * geotech axis defaulted ``showBands`` to true, so with no packing model the
 * ``PartitionFillOverlay`` fell through to painting the LITHO partition — a
 * clean slate that did not look clean ("thought u cleared the model, why is
 * there fill?").
 *
 * Pure module so the exclusivity is unit-testable without mounting the
 * ``SectionPanel`` god component.
 */

/** The section-view axis whose fill is being selected. */
export type SectionFillAxis = 'geological' | 'lithostratigraphic' | 'geotechnical'

/** Inputs to the fill-selection rule — the three toggles plus the axis state. */
export interface SectionFillInputs {
  axisMode: SectionFillAxis
  /** The litho axis "Fill bands" toggle (``bandFillStore``, default off). */
  bandFillVisible: boolean
  /** The geotech "Hide fill" toggle for the NAD fill (``geotechFillStore``). */
  geotechFillVisible: boolean
  /** The geotech "Show litho fill" toggle (``lithoFillOnGeotechStore``). */
  lithoFillOnGeotech: boolean
  /**
   * How many geotech units (packing bands) the refinement bundle actually
   * carries. NOT a boolean on the bundle existing: the canvas builds the
   * bundle whenever the axis is geotech — even with zero units — and the
   * refine engine with no bands falls back to painting the LITHO regions
   * (dogfeed 2026-08-06). Zero units = clean slate = no fill.
   */
  geotechUnitCount: number
}

/** What the overlay should paint. */
export interface SectionFillSelection {
  /** ``PartitionFillOverlay``'s ``showBands`` — whether any fill paints. */
  showBands: boolean
  /**
   * When true the caller passes ``refinement={undefined}`` to the overlay even
   * though a refinement exists, so the litho fill renders INSTEAD of the NAD
   * fill — never both (the one-fill-at-a-time rule).
   */
  withholdRefinement: boolean
}

/**
 * Select the fill for the current axis + toggle state.
 *
 * Rules, in the order they bind:
 *  - non-geotech axes: unchanged — ``bandFillVisible`` gates the litho fill,
 *    the refinement never exists there;
 *  - geotech + "Show litho fill" ON: the litho fill and ONLY the litho fill
 *    (the refinement is withheld so the NAD fill cannot stack under/over it);
 *  - geotech + toggle OFF + packing units present: the NAD fill, gated by its
 *    own "Hide fill" toggle;
 *  - geotech + toggle OFF + no packing units (no model, OR a model that has
 *    not been subdivided yet): NO fill — a clean slate looks clean.
 *
 * Parameters
 * ----------
 * inputs : SectionFillInputs
 *     Axis + the three fill toggles + refinement presence.
 *
 * Returns
 * -------
 * SectionFillSelection
 *     ``showBands`` for the overlay and whether to withhold the refinement.
 */
export function selectSectionFill(inputs: SectionFillInputs): SectionFillSelection {
  const { axisMode, bandFillVisible, geotechFillVisible, lithoFillOnGeotech, geotechUnitCount } =
    inputs
  if (axisMode !== 'geotechnical') {
    return { showBands: bandFillVisible, withholdRefinement: false }
  }
  if (lithoFillOnGeotech) {
    return { showBands: true, withholdRefinement: true }
  }
  return { showBands: geotechUnitCount > 0 && geotechFillVisible, withholdRefinement: false }
}
