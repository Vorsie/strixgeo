/**
 * Hard-bounds arithmetic for hand editing packing sub-bands on the geotech axis.
 *
 * Pure: no React, no network, no DOM. The drag reads {@link clampSplitDepth} every frame,
 * so the clamp the owner feels in the gesture and the clamp the server enforces on commit
 * are the same rule stated once.
 *
 * The rule (owner ruling 2, docs/debt.md #227, 2026-08-01, amended 2026-08-26): *"A packing
 * boundary moves freely inside its litho body and clamps at the edge. It can never move a
 * litho contact."* The litho unit is the one hard wall; the owner overrules the CLASS,
 * never the hierarchy.
 *
 * A GEOLOGICAL contact is NOT a wall (owner, 2026-08-26: *"just drop the wall everywhere,
 * user wil have to manually do it"*). This module never enforced one — it has always
 * clamped to the litho layer alone — but it used to justify that by claiming a litho body
 * could not span a geological contact, which was only true while the machine cut it there.
 * It no longer cuts, so a litho body CAN span a geological contact, and this module's
 * clamp is unchanged and correct: it is the litho wall, stated once. The server matches it
 * (``enclosing_litho_bounds``), which it did not before that date.
 *
 * @module components/sections/geotechBandEdit
 */

import type { LithoLayerResponse } from '../../api/client'
import { absorbRemainderThresholdM } from '../../utils/lithoLayerMerge'

/**
 * How far inside the litho body a hand-placed split is allowed to land, in metres.
 *
 * Not a geological rule and not the owner's minimum-thickness preference (that one only
 * warns — see ``geotechSubdivisionPrefs.minimumLayerThicknessM``). This is the structural
 * floor: layer depths are stored mm-rounded under a no-overlap exclusion constraint, so a
 * split landing exactly on the litho contact asks for a zero-thickness band and comes back
 * as a 500 instead of a layer. 1 cm is the frontend clamp that keeps that unreachable.
 */
export const SPLIT_EDGE_EPSILON_M = 0.01

/**
 * How close two band boundaries must be to count as touching, in metres.
 *
 * Matches the 1 cm contiguity tolerance the ``trg_litho_column_contiguous`` trigger
 * enforces, so this walk can never disagree with the database about what is adjacent.
 */
export const BAND_ADJACENCY_TOLERANCE_M = 0.01

/** A depth range on one column, positive down. */
export interface DepthInterval {
  /** Top of the range in metres below the collar. */
  topDepthM: number
  /** Base of the range in metres below the collar. */
  baseDepthM: number
}

/** One packing sub-band on one column — a geotech ``litho_layer`` row, reduced. */
export interface GeotechBandInterval extends DepthInterval {
  /** The geotech ``litho_layer`` id the split/merge endpoints take. */
  layerId: string
  /** The NAD-stamped geotech formation the band currently carries. */
  formationId: string
  /**
   * Whether the band hangs off a CPT (``true``) or a borehole (``false``).
   *
   * The row's own anchor, not the column's surroundings — the two are not the same thing,
   * because a borehole often stands a few metres from a CPT and the section draws them as
   * neighbours. Only the CPT carries cone resistance, which is what
   * {@link columnIsHandEditable} turns on.
   */
  anchorIsCpt: boolean
  /**
   * The resolver body the band belongs to, or ``null`` when the resolver has
   * not stamped it. OPTIONAL so the many hand-built test fixtures stay valid;
   * ``columnBands`` always fills it. Carried for the unit-statistics jump
   * (owner ruling 2026-08-27: a jump that knows its body must report it) —
   * no edit verb reads it.
   */
  bodyId?: string | null
}

/** Which wall stopped a proposed split, if any. */
export type SplitClampWall = 'none' | 'litho-top' | 'litho-base'

/** A proposed split depth after the hierarchy has had its say. */
export interface ClampedSplitDepth {
  /** The depth the split would actually be placed at, in metres. */
  depthM: number
  /** The wall that stopped it, or ``'none'`` when the cursor was already inside. */
  clampedAt: SplitClampWall
  /** Why it stopped, phrased for the readout; ``null`` when nothing stopped it. */
  clampReason: string | null
}

/** Whether two bands may be merged, and if not, the reason to show the owner. */
export type MergeEligibility = { ok: true } | { ok: false; reason: string }

/**
 * Clamp a proposed split depth into the litho body that bounds it.
 *
 * Inside the body the cursor is followed exactly, including across the owner's own packing
 * boundaries — those are his subdivision, not a level above him, so crossing one simply
 * re-targets which band gets split (see {@link bandAtDepth}). At the litho contact the
 * depth stops, one epsilon short, and reports which edge it hit so the gesture can say why.
 *
 * Parameters
 * ----------
 * lithoBody : DepthInterval
 *     The enclosing litho body — the hard wall on both sides.
 * rawDepthM : number
 *     The depth under the cursor, in metres, before any bound is applied.
 * epsilonM : number, optional
 *     How far inside the wall to stop. Defaults to {@link SPLIT_EDGE_EPSILON_M}.
 *
 * Returns
 * -------
 * ClampedSplitDepth
 *     The placed depth, the wall that stopped it, and the reason to display.
 */
export function clampSplitDepth(
  lithoBody: DepthInterval,
  rawDepthM: number,
  epsilonM: number = SPLIT_EDGE_EPSILON_M,
): ClampedSplitDepth {
  const { topDepthM, baseDepthM } = lithoBody
  // A body thinner than two epsilons has no legal interior; collapse to its middle so the
  // gesture degrades to "no room here" rather than inverting the bounds.
  const room = baseDepthM - topDepthM
  if (room <= 2 * epsilonM) {
    return {
      depthM: topDepthM + room / 2,
      clampedAt: 'none',
      clampReason: null,
    }
  }
  const lowest = topDepthM + epsilonM
  const deepest = baseDepthM - epsilonM
  if (rawDepthM <= lowest) {
    return {
      depthM: lowest,
      clampedAt: 'litho-top',
      clampReason:
        'Stopped at the top of the litho body. A packing boundary never crosses a litho contact.',
    }
  }
  if (rawDepthM >= deepest) {
    return {
      depthM: deepest,
      clampedAt: 'litho-base',
      clampReason:
        'Stopped at the base of the litho body. A packing boundary never crosses a litho contact.',
    }
  }
  return { depthM: rawDepthM, clampedAt: 'none', clampReason: null }
}

/**
 * Find the litho body a depth falls in.
 *
 * Parameters
 * ----------
 * lithoBodies : readonly DepthInterval[]
 *     The litho layers on the edited column, any order.
 * depthM : number
 *     Depth in metres below the collar.
 *
 * Returns
 * -------
 * DepthInterval | null
 *     The containing body, or ``null`` when the depth is below the deepest litho layer
 *     (nothing bounds a split there, so none may be placed).
 */
export function enclosingLithoBody(
  lithoBodies: readonly DepthInterval[],
  depthM: number,
): DepthInterval | null {
  for (const body of lithoBodies) {
    // Half-open [top, base) matches how the build samples a band, so a depth sitting
    // exactly on a contact belongs to the body below it — one owner, never two.
    if (depthM >= body.topDepthM && depthM < body.baseDepthM) return body
  }
  return null
}

/**
 * Find the packing band a depth falls in.
 *
 * Parameters
 * ----------
 * bands : readonly GeotechBandInterval[]
 *     The packing bands on the edited column.
 * depthM : number
 *     Depth in metres below the collar.
 *
 * Returns
 * -------
 * GeotechBandInterval | null
 *     The band that would be split, or ``null`` when no band covers the depth.
 */
export function bandAtDepth(
  bands: readonly GeotechBandInterval[],
  depthM: number,
): GeotechBandInterval | null {
  for (const band of bands) {
    if (depthM >= band.topDepthM && depthM < band.baseDepthM) return band
  }
  return null
}

/**
 * Reduce a model-wide layer list to one column's bands, shallowest first.
 *
 * Parameters
 * ----------
 * layers : readonly LithoLayerResponse[]
 *     Geotech (or litho) layer rows across every column.
 * investigationId : string
 *     The CPT or borehole id whose column is being edited.
 *
 * Returns
 * -------
 * GeotechBandInterval[]
 *     The column's bands sorted top to bottom, so the stack matches the drawing.
 */
export function columnBands(
  layers: readonly (Pick<
    LithoLayerResponse,
    'id' | 'formation_id' | 'cpt_id' | 'borehole_id' | 'depth_top_m' | 'depth_base_m'
  > &
    Partial<Pick<LithoLayerResponse, 'body_id'>>)[],
  investigationId: string,
): GeotechBandInterval[] {
  return layers
    .filter(l => (l.cpt_id ?? l.borehole_id) === investigationId)
    .map(l => ({
      layerId: l.id,
      formationId: l.formation_id,
      anchorIsCpt: l.cpt_id !== null && l.cpt_id !== undefined,
      topDepthM: l.depth_top_m,
      baseDepthM: l.depth_base_m,
      bodyId: l.body_id ?? null,
    }))
    .sort((a, b) => a.topDepthM - b.topDepthM)
}

/**
 * Whether a column's packing bands may be hand-edited at all (owner ruling A, 2026-08-01).
 *
 * Only on a CPT. Both verbs re-derive the NAD packing class from the cone resistance over
 * the band's new extent, and a borehole records none — so on a borehole there is nothing to
 * re-derive the class from, and going ahead would trade the class `Divide boreholes`
 * extrapolated onto the column from the surrounding CPTs for no class at all. The server
 * refuses the same edit for the same reason; this is what keeps the gesture from being
 * offered in the first place, so the refusal is never something the owner discovers by
 * being told no.
 *
 * Not offered rather than offered-and-refused, the way a merge across a litho contact simply
 * has no handle (see {@link canMergeBands}).
 *
 * Parameters
 * ----------
 * bands : readonly GeotechBandInterval[]
 *     The packing bands on one column.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when every band on the column hangs off a CPT. An empty column is not
 *     editable — there is nothing to edit.
 */
export function columnIsHandEditable(bands: readonly GeotechBandInterval[]): boolean {
  return bands.length > 0 && bands.every(band => band.anchorIsCpt)
}

/**
 * Which litho body each band of a pair sits in.
 *
 * Private: the probe both {@link canMergeBands} and {@link boundaryRestatesLithoContact}
 * ask, kept in one place so a merge and a contact drag can never disagree about which
 * body a band belongs to.
 *
 * @param upper The shallower band of the pair.
 * @param lower The deeper band of the pair.
 * @param lithoBodies The litho layers on this column.
 * @returns The enclosing body of each band; either may be `null` when the band falls
 *   outside the litho stack.
 */
function pairLithoBodies(
  upper: GeotechBandInterval,
  lower: GeotechBandInterval,
  lithoBodies: readonly DepthInterval[],
): { upperBody: DepthInterval | null; lowerBody: DepthInterval | null } {
  // Probe each band at its own midpoint: a band that exactly spans its body would otherwise
  // resolve by its top depth alone and could pick up the body above on a shared contact.
  return {
    upperBody: enclosingLithoBody(lithoBodies, (upper.topDepthM + upper.baseDepthM) / 2),
    lowerBody: enclosingLithoBody(lithoBodies, (lower.topDepthM + lower.baseDepthM) / 2),
  }
}

/**
 * Whether the boundary between two touching bands IS a lithostratigraphic contact.
 *
 * The exact condition {@link canMergeBands} refuses on — stated once, so the two callers
 * can never drift into disagreeing about what a contact is. A merge and a contact drag are
 * opposite answers to the same question: the boundary a packing merge may NOT cross is
 * precisely the one the contact drag owns.
 *
 * Parameters
 * ----------
 * upper : GeotechBandInterval
 *     The shallower band of the pair.
 * lower : GeotechBandInterval
 *     The deeper band of the pair.
 * lithoBodies : readonly DepthInterval[]
 *     The litho layers on this column.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when the two bands touch and sit in DIFFERENT litho bodies. A pair inside
 *     one body is the owner's own subdivision (an internal packing boundary); a pair that
 *     does not touch, or that falls outside the litho stack entirely, restates nothing.
 */
export function boundaryRestatesLithoContact(
  upper: GeotechBandInterval,
  lower: GeotechBandInterval,
  lithoBodies: readonly DepthInterval[],
): boolean {
  if (Math.abs(upper.baseDepthM - lower.topDepthM) > BAND_ADJACENCY_TOLERANCE_M) return false
  const { upperBody, lowerBody } = pairLithoBodies(upper, lower, lithoBodies)
  return upperBody !== null && lowerBody !== null && upperBody !== lowerBody
}

/**
 * Decide whether two packing bands may be merged by hand.
 *
 * Refuses on the hierarchy and on nothing else. A refusal here is ruling 2 doing its job;
 * a refusal on qc grounds would be a defect (ruling 5 — manual override always wins), which
 * is why nothing about the classes is consulted.
 *
 * Parameters
 * ----------
 * upper : GeotechBandInterval
 *     The shallower band of the pair.
 * lower : GeotechBandInterval
 *     The deeper band of the pair.
 * lithoBodies : readonly DepthInterval[]
 *     The litho layers on the edited column.
 *
 * Returns
 * -------
 * MergeEligibility
 *     ``{ ok: true }``, or the reason the hierarchy forbids it.
 */
export function canMergeBands(
  upper: GeotechBandInterval,
  lower: GeotechBandInterval,
  lithoBodies: readonly DepthInterval[],
): MergeEligibility {
  if (Math.abs(upper.baseDepthM - lower.topDepthM) > BAND_ADJACENCY_TOLERANCE_M) {
    return {
      ok: false,
      reason: 'These two bands do not touch. There is other material between them.',
    }
  }
  const { upperBody, lowerBody } = pairLithoBodies(upper, lower, lithoBodies)
  if (upperBody === null || lowerBody === null) {
    return {
      ok: false,
      reason: 'One of these bands is not inside a litho body, so it has no bounds to merge within.',
    }
  }
  if (upperBody !== lowerBody) {
    return {
      ok: false,
      // The rule is the half that has not changed and it stays stated in full. What
      // changed on 2026-08-08 is the remedy: the contact became draggable on this axis
      // too (``geotechContactDrag``), so naming the litho axis as the ONLY route would
      // send the engineer away from a gesture he can make where he is standing. Near
      // remedy first, the other axis as the alternative it now is.
      reason:
        'These bands sit in different lithological units. The boundary between them is a ' +
        'litho contact, and a packing boundary never crosses one. Drag the contact itself to ' +
        'move it, or edit it on the litho axis.',
    }
  }
  return { ok: true }
}


/** Where a dragged boundary stopped, and on which band edge. */
export interface ClampedDragDepth {
  /** The clamped boundary depth (m below collar). */
  depthM: number
  /** Which limit stopped the drag, or 'none' when the cursor was followed. */
  atLimit: 'upper' | 'lower' | 'none'
}

/**
 * Clamp a dragged packing boundary to the pair it belongs to.
 *
 * The drag verb (owner 2026-08-07) is only offered on a mergeable pair — same
 * litho body, so the pair's own envelope IS ruling 2's wall: the boundary
 * moves freely between the pair's outer edges and visibly refuses to leave
 * them (a rejection met only on release would be the worse answer, exactly as
 * with the split clamp). The epsilon keeps both survivors real rows.
 *
 * @param upper The shallower band of the pair.
 * @param lower The deeper band of the pair.
 * @param rawDepthM The cursor's depth this frame.
 * @param epsilonM Structural floor (defaults to `SPLIT_EDGE_EPSILON_M`).
 * @returns The clamped depth and which limit stopped it, if any.
 */
export function clampDragDepth(
  upper: DepthInterval,
  lower: DepthInterval,
  rawDepthM: number,
  epsilonM: number = SPLIT_EDGE_EPSILON_M,
): ClampedDragDepth {
  const min = upper.topDepthM + epsilonM
  const max = lower.baseDepthM - epsilonM
  if (rawDepthM < min) return { depthM: min, atLimit: 'upper' }
  if (rawDepthM > max) return { depthM: max, atLimit: 'lower' }
  return { depthM: rawDepthM, atLimit: 'none' }
}

/**
 * Whether releasing the drag at `depthM` should ABSORB one of the pair.
 *
 * Owner decision 2026-08-07: "Absorb, like litho" — when the drag squeezes a
 * neighbour below `max(0.1 m, 15 %)` of its ORIGINAL thickness remaining
 * (`absorbRemainderThresholdM`, the exact helper the litho ghost cross-merge
 * uses), the release becomes a MERGE of the pair instead of a move. The
 * merged interval's class then re-derives from the qc over the union
 * (ruling 3) through the shipped merge endpoints — the server never owns this
 * threshold, because a server converting "move" into "delete a band" behind
 * the caller's back would break preview honesty (ruling 6).
 *
 * @param upper The shallower band of the pair (original extents).
 * @param lower The deeper band of the pair (original extents).
 * @param depthM The proposed boundary depth.
 * @returns Which side would be absorbed, or `null` for a plain move.
 */
export function dragAbsorbPrediction(
  upper: DepthInterval,
  lower: DepthInterval,
  depthM: number,
): { side: 'upper' | 'lower' } | null {
  const upperRemaining = depthM - upper.topDepthM
  const lowerRemaining = lower.baseDepthM - depthM
  const upperThreshold = absorbRemainderThresholdM(upper.baseDepthM - upper.topDepthM)
  const lowerThreshold = absorbRemainderThresholdM(lower.baseDepthM - lower.topDepthM)
  // An absorb is a SQUEEZE: only the band the drag is closing on can be
  // absorbed. Without this direction test a band that was ALREADY thinner than
  // the 10 cm floor reads as collapsing at every cursor position — including
  // at rest and while being GROWN — so the release would silently merge a pair
  // the engineer meant only to nudge. The pair's resting boundary is the
  // shared edge the two intervals still carry.
  const restingBoundaryM = upper.baseDepthM
  const upperCollapses = depthM < restingBoundaryM && upperRemaining < upperThreshold
  const lowerCollapses = depthM > restingBoundaryM && lowerRemaining < lowerThreshold
  if (upperCollapses && lowerCollapses) {
    // Pathologically thin pair: the nearer edge wins.
    return upperRemaining <= lowerRemaining ? { side: 'upper' } : { side: 'lower' }
  }
  if (upperCollapses) return { side: 'upper' }
  if (lowerCollapses) return { side: 'lower' }
  return null
}
