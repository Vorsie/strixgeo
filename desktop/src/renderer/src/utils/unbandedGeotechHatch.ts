/**
 * The "correlate me" texture for un-banded ground on the geotech axis.
 *
 * THE CASE (owner's model, 2026-08-14). On the geotech axis a column can carry
 * a classified packing band — KLEI NAD 23 — while the area beside it has no
 * packing region at that elevation, because no accepted tie reaches across.
 * The litho frame paints that area in plain lithology colour, so the same clay
 * meets itself in two tones at the card edge (220 / 288 / 149 card-edge samples
 * on CS1 / CS2 / CS3). The tone difference is a lie about lithology.
 *
 * OWNER RULING, verbatim: *"sure read as correlate me on the extra ruling is
 * fine"* — keep BOTH truths (the derived class stays, the lithology stays) and
 * stop the un-banded area from IMPERSONATING a class. It gets a texture that
 * reads as unfinished work, and the texture disappears as he correlates.
 *
 * Two rejected options are worth naming so they are not re-proposed: the
 * classified card falling back too (hides real derived data), and the bare area
 * taking the card's class (invents a correlation nobody drew).
 *
 * THE TEXTURE. A back-slash diagonal hatch, deliberately the mirror of every
 * other hatch on this canvas: the litho pending ghosts and the geotech
 * borehole-preview ghosts both mean "not committed yet" and both draw a 45°
 * FORWARD-slash black hatch at 3-6 px with a 1.4 stroke, and the DOV clay
 * pattern (``soil-KL``) is a forward-slash hatch too. This one leans the other
 * way, at roughly twice the spacing, in slate rather than black, at an opacity
 * below all of them — so it is unmistakable at a glance yet stays quiet over
 * the large areas an un-correlated section carries.
 *
 * Pure module: the caller owns projection and paint, this owns the rule and the
 * texture's constants.
 */

/**
 * SVG ``<pattern>`` id for the texture.
 *
 * Deliberately ONE id for the whole app, unlike the litho pending ghosts (one
 * per investigation): every instance of this pattern is byte-identical, so two
 * overlays in one document colliding on the id resolve to the same paint.
 */
export const UNBANDED_HATCH_PATTERN_ID = 'partition-unbanded-hatch'

/**
 * What the engineer reads on hover.
 *
 * Says what is TRUE and never says "fallback" — that word is an internal
 * identifier (``lithoFallbackRegions``, ``geotechFillFallback.ts``), never UI
 * text: to an engineer it would read as a failure rather than as work he has
 * not done yet.
 */
export const UNBANDED_HATCH_LABEL = 'No packing bands here yet. Not correlated yet'

/**
 * Hatch line spacing, px.
 *
 * Wider than the "not committed yet" ghosts (3 px weak / 6 px strong) and the
 * DOV clay pattern (6 px), so the two textures never read alike even side by
 * side, and so the texture stays a whisper over a whole un-correlated section.
 */
export const UNBANDED_HATCH_SPACING_PX = 12

/** Hatch stroke width, px — thinner than the ghosts' 1.4. */
export const UNBANDED_HATCH_STROKE_WIDTH = 0.9

/** Hatch stroke opacity — below the ghosts' 0.28-0.38 (quiet, not shouting). */
export const UNBANDED_HATCH_STROKE_OPACITY = 0.22

/** Hatch ink: slate-600, so it never reads as the ghosts' black. */
export const UNBANDED_HATCH_INK = '#475569'

/**
 * Pattern rotation, degrees.
 *
 * Negative = a BACK-slash, the mirror of every ``rotate(45)`` hatch already on
 * the section canvas. Direction is the primary channel that separates this from
 * "not committed yet".
 */
export const UNBANDED_HATCH_ROTATION_DEG = -45

/** One projected fill the texture rule judges. */
export interface HatchCandidateFill {
  /** The caller's key for the rendered element. */
  key: string
  /** The element's SVG path data — the texture is drawn over the same shape. */
  d: string
  /**
   * ``'unbanded'`` = an area the packing model has NO bands for (the litho
   * frame resolves it to lithology); ``'packed'`` = a fill carrying a derived
   * packing class.
   */
  kind: 'unbanded' | 'packed'
}

/** Inputs to the texture rule. */
export interface UnbandedHatchInputs {
  /** The section axis being rendered. */
  axisMode?: 'geological' | 'lithostratigraphic' | 'geotechnical'
  /**
   * True when the geotech partition is framed by the litho model — i.e. the
   * ``lithoFrame`` bundle is present. False in the "Show litho fill" view,
   * where ``SectionPanel`` withholds the frame and the litho model IS the fill:
   * a deliberate lithology view, which must stay untextured.
   */
  geotechPartitionFramed: boolean
  /** Every fill the overlay is about to paint, with its kind. */
  candidates: readonly HatchCandidateFill[]
}

/** A fill to draw the texture over. */
export interface UnbandedHatchFill {
  key: string
  d: string
}

/**
 * Select the fills that must read as "correlate me".
 *
 * The rule, in the order it binds:
 *  - off the geotech axis: nothing (the litho axis is untouched entirely);
 *  - geotech axis without the litho frame ("Show litho fill"): nothing — that
 *    view is lithology by request, not un-banded ground;
 *  - otherwise: exactly the ``'unbanded'`` candidates, in the caller's order.
 *
 * Parameters
 * ----------
 * inputs : UnbandedHatchInputs
 *     Axis, whether the geotech partition is litho-framed, and the candidates.
 *
 * Returns
 * -------
 * UnbandedHatchFill[]
 *     Key + geometry for each fill to texture; empty when the rule does not
 *     apply.
 */
export function selectUnbandedHatchFills(inputs: UnbandedHatchInputs): UnbandedHatchFill[] {
  const { axisMode, geotechPartitionFramed, candidates } = inputs
  if (axisMode !== 'geotechnical') return []
  if (!geotechPartitionFramed) return []
  return candidates
    .filter((c) => c.kind === 'unbanded')
    .map((c) => ({ key: c.key, d: c.d }))
}
