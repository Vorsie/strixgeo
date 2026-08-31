/**
 * contactOverrideWiring.ts — the APP → ENGINE bridge for MATCHED TWO-BAND CONTACT
 * free-draw (S68). Given a gap's two litho columns + the stored boundary control
 * nodes, it produces the ``contact:U|L@g`` apex overrides the v2 engine consumes
 * (``partitionFillV2/contactOverride.ts`` — S67). Pure module: no React, no I/O.
 *
 * Why this exists (root, §71/§73): a horizontal contact between two full-width
 * bands is shaped by a node the app stores on the UPPER band body's
 * ``lower_nodes`` (``handleBoundaryAddNode``). The v2 engine now re-partitions BOTH
 * bands from a single ``contact:upper|lower@gap`` override (both incident faces
 * re-derive from the ONE bent shared boundary — 0 holes / 0 overlaps by
 * construction). The app must therefore FEED that override instead of running the
 * old off-engine single-body reshape (which grew the upper band and left the lower
 * band's top put → the "targets top + gap" dogfeed).
 *
 * The engine matches the override key against the ELEVATION-SET of bodies bounding
 * the contact tie (``collectContactBends``), so whichever ``bodyId`` the app keys
 * on (rendered ``PartitionRegion.bodyId`` ≠ engine ``UnitGeom.bodyId``) resolves to
 * its band's real contact. This module keys on the litho columns' own ``bodyId``s.
 */

import { type BodyBoundaryNode, type BodyBoundaryResponse } from '../../api/client'
import { contactApexOverrideKey } from '../../utils/partitionFillV2/contactOverride'
import { type LensApexOverride, type PartitionColumn, type PartitionUnit } from '../../utils/sectionPartition'

/** Contact-elevation match epsilon in metres (the units are pre-arrangement-snap). */
const CONTACT_MATCH_M = 1e-3

/** Live drag state fields this module reads (a structural subset of ``BoundaryDrag``). */
export interface ContactDragState {
  upperBodyId: string
  lowerBodyId: string
  nodeIndex: number
  x: number
  y: number
  leftX: number
  rightX: number
  /**
   * S86 press-to-grab: this drag CREATED the contact node on mousedown (it is not yet
   * stored on the upper body's ``lower_nodes``). The live override must synthesize the
   * control point from the drag cursor so a new contact bend reshapes on the SAME
   * press-drag; without it, an empty boundary has no in-gap node → no override → the
   * new node does not render until it persists (the old two-step gesture). On mouseup
   * the overlay APPENDS the node and persists; from then on it is an ordinary stored
   * node (``isNew`` absent).
   */
  isNew?: boolean
}

/**
 * Classify a free-draw click target as a two-sided CONTACT or a one-sided APEX (lens/onlap).
 *
 * The protocol distinction the free-draw tool must honour (owner brief): a shared contact
 * between two full-width bands is shaped by a ``contact:U|L@g`` override; a one-sided lens/
 * onlap tip is shaped by a ``bodyId@gap`` apex override. Merging them via a hit-test heuristic
 * is what the repair forbids — so the click target is CLASSIFIED before an override is generated.
 *
 * The geometric signal (already used inline by ``collectContactOverridesForGap`` and the lens
 * ``setShape`` path): a body present in BOTH gap columns is a full-width band → its base is a
 * two-sided shared contact → ``'contact'``. A body present in only ONE column terminates inside
 * the gap → its tip is a one-sided apex → ``'apex'``.
 *
 * Parameters
 * ----------
 * bodyId : string
 *     The clicked body's id.
 * left, right : PartitionColumn
 *     The gap's two litho columns.
 *
 * Returns
 * -------
 * 'contact' | 'apex'
 *     ``'contact'`` when the body spans both columns (two-sided), else ``'apex'`` (one-sided).
 */
export function classifyFreeDrawTarget(
  bodyId: string,
  left: PartitionColumn,
  right: PartitionColumn,
): 'contact' | 'apex' {
  const onLeft = left.units.some((u) => u.bodyId === bodyId)
  const onRight = right.units.some((u) => u.bodyId === bodyId)
  return onLeft && onRight ? 'contact' : 'apex'
}

/** The absolute elevation (mTAW) of a unit's TOP contact. */
function unitTopElev(col: PartitionColumn, u: PartitionUnit): number {
  return col.surfaceElevM - u.topDepthM
}

/** The absolute elevation (mTAW) of a unit's BASE contact. */
function unitBaseElev(col: PartitionColumn, u: PartitionUnit): number {
  return col.surfaceElevM - u.baseDepthM
}

/**
 * The BASE elevation of a body across the two columns (min base = its own floor).
 * Returns null when the body has no unit in either column.
 */
function bodyBaseElev(left: PartitionColumn, right: PartitionColumn, bodyId: string): number | null {
  let base = Infinity
  for (const col of [left, right])
    for (const u of col.units) if (u.bodyId === bodyId) base = Math.min(base, unitBaseElev(col, u))
  return Number.isFinite(base) ? base : null
}

/**
 * Find the LOWER body of a two-band contact: the body whose TOP contact sits at
 * ``contactElev`` across either column, excluding the upper body itself. Returns
 * the first match (the elevation-set match in the engine handles the rest), or
 * null when no band sits directly below.
 */
function lowerBodyAtContact(
  left: PartitionColumn,
  right: PartitionColumn,
  contactElev: number,
  upperBodyId: string,
): string | null {
  for (const col of [left, right]) {
    for (const u of col.units) {
      if (u.bodyId == null || u.bodyId === upperBodyId) continue
      if (Math.abs(unitTopElev(col, u) - contactElev) <= CONTACT_MATCH_M) return u.bodyId
    }
  }
  return null
}

/**
 * Build the matched-two-band ``contact:U|L@g`` overrides for ONE gap.
 *
 * A contact-shaping node lives on ``boundariesByBodyId[upperBody].lower_nodes``.
 * The upper body is any body present on BOTH columns (a full-width band, so a
 * two-sided contact — the one-sided lens/onlap path is handled separately by
 * ``lensApexOverrideKey``). For each such body with an in-gap lower node, the
 * LOWER body is the band whose top sits at the upper body's NATURAL base contact;
 * the override control point is the node's (fraction, elevation), with the live
 * drag applied so the on-screen preview re-partitions per frame.
 *
 * Writes into ``out`` (the shared ``apexOverrides`` map fed to the engine) so the
 * ``contact:`` keys sit alongside the single-body ``bodyId@gap`` lens keys without
 * collision (distinct namespace). No contact node → no entry (byte-identical).
 *
 * Parameters
 * ----------
 * gapIndex : number
 *     The gap.
 * left, right : PartitionColumn
 *     The gap's two columns.
 * leftX, rightX : number
 *     The gap's screen x-extent (for node ownership + the fraction map).
 * boundariesByBodyId : ReadonlyMap<string, BodyBoundaryResponse> | undefined
 *     Stored per-body boundary shapes (the contact node source).
 * alongToScreenX : (along: number) => number
 *     Along-metres → screen x (the warped transform).
 * screenToLevel : ((y: number) => number) | undefined
 *     Screen y → elevation (for the live drag; when absent the drag falls back to
 *     the stored elevation).
 * drag : ContactDragState | null
 *     The active boundary drag, so the dragged node reads the live cursor.
 * out : Map<string, LensApexOverride>
 *     The override map to populate (mutated).
 * skipBodyIds : ReadonlySet<string> | null
 *     Two-sided bodies whose in-gap node is already applied as a ``bodyId@gap`` lens
 *     apex override (§88 live drag OR §91 persisted lens tip), so the contact path must
 *     NOT also emit a ``contact:U|L@g`` bend for them (the same node would be
 *     double-applied — once as a lens tip, once as a shared-contact bend). The drag /
 *     persist KIND (lens) decides, not the body's two-sidedness (which reads as a
 *     contact by geometry alone). ``null`` (the default caller) preserves the original
 *     behaviour.
 *
 * Returns
 * -------
 * Set<string>
 *     The ``(upperBodyId)`` set whose contact was overridden in this gap — the
 *     caller gates the off-engine POST-BEND reshape off for these.
 */
export function collectContactOverridesForGap(
  gapIndex: number,
  left: PartitionColumn,
  right: PartitionColumn,
  leftX: number,
  rightX: number,
  boundariesByBodyId: ReadonlyMap<string, BodyBoundaryResponse> | undefined,
  alongToScreenX: (along: number) => number,
  screenToLevel: ((y: number) => number) | undefined,
  drag: ContactDragState | null,
  out: Map<string, LensApexOverride>,
  skipBodyIds: ReadonlySet<string> | null = null,
): Set<string> {
  const overridden = new Set<string>()
  if (!boundariesByBodyId) return overridden
  const gapW = rightX - leftX
  if (gapW <= 0) return overridden

  // Bodies present on BOTH columns = full-width bands = matched-contact candidates.
  const leftIds = new Set(left.units.map((u) => u.bodyId).filter((id): id is string => !!id))
  const rightIds = new Set(right.units.map((u) => u.bodyId).filter((id): id is string => !!id))
  const twoSided = [...leftIds].filter((id) => rightIds.has(id))

  const inGap = (n: BodyBoundaryNode): boolean => {
    const x = alongToScreenX(n.along_m)
    return x >= leftX && x <= rightX
  }
  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

  for (const upperBodyId of twoSided) {
    // §88 / §91 disentangle: this body's node is already a lens apex override in this gap.
    if (skipBodyIds?.has(upperBodyId)) continue
    const bnd = boundariesByBodyId.get(upperBodyId)

    // The natural base contact of the upper band = where the lower band's top sits.
    const naturalBase = bodyBaseElev(left, right, upperBodyId)
    if (naturalBase == null) continue
    const lowerBodyId = lowerBodyAtContact(left, right, naturalBase, upperBodyId)
    if (lowerBodyId == null) continue

    const nodes = (bnd?.lower_nodes ?? []).filter(inGap)
    // S86 press-to-grab: an ``isNew`` contact drag targeting THIS contact synthesizes the
    // control point from the live cursor even before it is stored, so the new contact bend
    // reshapes on the same press-drag. Requires matching the exact (upper, lower, gap).
    // S110: a body dragged onlap-intervening may own NO stored boundary yet (its first node is
    // created on this press) — the ``bnd`` may be undefined. Mirror the lens ``setShape`` gate: an
    // ``isNew`` drag synthesizes the control point from the cursor regardless of a stored boundary,
    // so proceed with empty stored nodes when THIS contact is the ``isNew`` drag target.
    const draggingThisNew =
      !!drag &&
      drag.isNew === true &&
      drag.upperBodyId === upperBodyId &&
      drag.lowerBodyId === lowerBodyId &&
      drag.nodeIndex === 0 &&
      Math.abs(drag.leftX - leftX) < 0.5
    // No stored boundary AND not a new-node drag here → nothing to override (byte-identical).
    if (!bnd && !draggingThisNew) continue
    // No stored in-gap node AND not a new-node drag here → nothing to override.
    if (nodes.length === 0 && !draggingThisNew) continue

    // Take the first in-gap node as the control point (single-node contact bend;
    // multi-node contact freedraw stays on the existing per-node handles for now).
    // ``boundaryDrag.nodeIndex`` is the IN-GAP index (matches ``sharedBoundaries``),
    // so the first in-gap node is index 0. For an ``isNew`` drag on an empty edge the
    // cursor IS the control point (no stored node to read).
    let cx = nodes.length > 0 ? alongToScreenX(nodes[0].along_m) : leftX
    let cyElev = nodes.length > 0 ? nodes[0].elevation_m : (naturalBase ?? 0)
    if (
      drag &&
      drag.upperBodyId === upperBodyId &&
      drag.lowerBodyId === lowerBodyId &&
      drag.nodeIndex === 0 &&
      Math.abs(drag.leftX - leftX) < 0.5
    ) {
      cx = Math.max(leftX + 1, Math.min(rightX - 1, drag.x))
      cyElev = screenToLevel ? screenToLevel(drag.y) : cyElev
    }
    const fraction = clamp01((cx - leftX) / gapW)

    out.set(contactApexOverrideKey(upperBodyId, lowerBodyId, gapIndex), {
      fraction,
      elevation: cyElev,
      // Contact bends are single control points (the shared boundary is one curve);
      // no upper/lower node chains (those are the lens freedraw shape).
      upper: [],
      lower: [],
    } as unknown as LensApexOverride)
    overridden.add(upperBodyId)
  }
  return overridden
}
