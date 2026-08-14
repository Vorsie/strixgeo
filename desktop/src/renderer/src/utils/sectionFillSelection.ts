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
 * Owner ruling 2026-08-13: the geotech axis's default fill is now the DIRECT
 * geotech partition (the geotech model's own columns + ties through the same
 * engine), so the "Show litho fill" toggle swaps the partition's SOURCE MODEL
 * rather than withholding a refinement pass.
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
   * How many geotech units (packing bands) the geotech model actually carries
   * on this section. NOT a boolean on the geotech bundle existing: the canvas
   * assembles it whenever the axis is geotech, even with zero bands. Zero
   * units = clean slate = no fill (dogfeed 2026-08-06).
   */
  geotechUnitCount: number
  /**
   * How many ACCEPTED packing ties the section carries. With zero, every band
   * pinches mid-gap and the fill is "useless clutter before the ties are
   * there" (owner, dogfeed 2026-08-14 night) — pipeline step 1 alone must not
   * turn it on; step 2's born-accepted restatements (or a hand tie) do.
   */
  geotechAcceptedTieCount: number
}

/** What the overlay should paint. */
export interface SectionFillSelection {
  /** ``PartitionFillOverlay``'s ``showBands`` — whether any fill paints. */
  showBands: boolean
  /**
   * True on the geotech axis when "Show litho fill" is on: the overlay's
   * partition is framed by the LITHO model instead of the geotech one, so the
   * litho fill is the only fill — never both (the one-fill-at-a-time rule).
   * Threaded into ``partitionEdgeSource`` / ``partitionLayerSource``.
   */
  showLithoFillInstead: boolean
}

/**
 * Select the fill for the current axis + toggle state.
 *
 * Rules, in the order they bind:
 *  - non-geotech axes: unchanged — ``bandFillVisible`` gates the litho fill;
 *  - geotech + "Show litho fill" ON: the litho fill and ONLY the litho fill
 *    (the partition itself swaps model, so the packing fill cannot stack
 *    under/over it);
 *  - geotech + toggle OFF + packing units AND at least one accepted tie: the
 *    DIRECT geotech partition, gated by its own "Hide fill" toggle (with no
 *    ties everything pinches — clutter, not information);
 *  - geotech + toggle OFF + no packing units (no model, OR a model that has
 *    not been subdivided yet): NO fill — a clean slate looks clean.
 *
 * Parameters
 * ----------
 * inputs : SectionFillInputs
 *     Axis + the three fill toggles + the geotech band count.
 *
 * Returns
 * -------
 * SectionFillSelection
 *     ``showBands`` for the overlay and which model frames its partition.
 */
export function selectSectionFill(inputs: SectionFillInputs): SectionFillSelection {
  const {
    axisMode,
    bandFillVisible,
    geotechFillVisible,
    lithoFillOnGeotech,
    geotechUnitCount,
    geotechAcceptedTieCount,
  } = inputs
  if (axisMode !== 'geotechnical') {
    return { showBands: bandFillVisible, showLithoFillInstead: false }
  }
  if (lithoFillOnGeotech) {
    return { showBands: true, showLithoFillInstead: true }
  }
  return {
    showBands: geotechUnitCount > 0 && geotechAcceptedTieCount > 0 && geotechFillVisible,
    showLithoFillInstead: false,
  }
}
