/**
 * apexOverrideWiring.ts — the APP → ENGINE bridge that builds the per-(body, gap)
 * lens apex overrides (``bodyId@gap``) AND the matched-two-band contact overrides
 * (``contact:U|L@g``) the partition engine consumes. Pure module: no React, no I/O.
 *
 * Extracted from ``PartitionFillOverlay``'s ``sectionFillData`` memo (S88) so the
 * REAL override-building path — the ``setShape`` gate + the two XOR loops — is
 * unit-testable. The engine reshape tests feed an override map DIRECTLY to
 * ``computeSectionFillV2``; that BYPASSES this gate, which is exactly why the
 * "manual reshape does nothing" bug hid behind green reshape tests: the app never
 * built the override for a two-sided body's lens tip because the XOR gate skips it.
 *
 * The gate (§88 root cause): a body is shaped as a one-sided lens tip only when it
 * lives on EXACTLY ONE side of the gap (``leftIds`` XOR ``rightIds``). A full-width
 * band present on BOTH columns is skipped there (its base is a two-sided contact,
 * routed through ``collectContactOverridesForGap`` instead). But such a band can
 * ALSO own a genuine LENS tip inside the gap (a lens pinching off a full-width
 * matrix). Dragging that lens handle must build its ``bodyId@gap`` apex override —
 * the XOR gate alone never does. The fix adds the dragged two-sided body back in
 * for its lens tip, and disentangles it from the contact path so the SAME node is
 * never double-applied as both a lens apex and a shared-contact bend.
 */

import { type BodyBoundaryNode, type BodyBoundaryResponse } from '../../api/client'
import {
  type LensApexOverride,
  lensApexOverrideKey,
  type PartitionColumn,
  type SectionRegion,
} from '../../utils/sectionPartition'
import { collectContactOverridesForGap, type ContactDragState } from './contactOverrideWiring'
import { isApexShapeable } from './partitionFillOverlayHelpers'

/**
 * Ownership epsilon (screen px): a node whose projected x sits within this
 * distance of a gap edge still counts as owned by that gap. Mirrors the overlay's
 * ``NODE_OWN_EPS`` (kept in sync — a sub-px change either way is a render seam, not
 * a functional change).
 */
const NODE_OWN_EPS = 0.5

/** Elevation match epsilon (metres) for the §91 tip-span membership test. */
const CONTACT_MATCH_M = 1e-3

/** Clamp a value to [0, 1]. */
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))

/**
 * Minimum visible apex reach (S72): floor the apex fraction to ≥ 8 % of the gap
 * from either anchored side so a click near a column face can never pinch the lens
 * to a hairline sliver. Mirrors the overlay's ``clampVisibleApex``.
 */
const MIN_VISIBLE_APEX_FRACTION = 0.08
const clampVisibleApex = (f: number): number =>
  Math.max(MIN_VISIBLE_APEX_FRACTION, Math.min(1 - MIN_VISIBLE_APEX_FRACTION, f))

/** Live lens-drag state fields this module reads (a structural subset of ``LensDrag``). */
export interface LensDragState {
  bodyId: string
  gapIndex: number
  edge: 'upper' | 'lower'
  nodeIndex: number
  leftX: number
  x: number
  y: number
  /**
   * S86 press-to-grab: this drag CREATED the node on mousedown (it is not yet in
   * ``boundariesByBodyId``). ``nodeIndex`` is the WOULD-BE index (the dragged edge's
   * current length). The live override must INJECT the dragged node so a new node
   * reshapes on the same press-drag — without this the new node has no stored slot to
   * override and nothing renders until it persists (the old two-step gesture). On
   * mouseup the overlay APPENDS the node and persists; from then on it is an ordinary
   * stored node and this flag is absent.
   */
  isNew?: boolean
}

/** One gap's screen x-extent (left column right face → right column left face). */
export interface GapExtent {
  leftX: number
  rightX: number
}

/** Inputs for building the per-gap override map. Pure snapshot of the memo's closure. */
export interface ApexOverrideInputs {
  orderedColumns: readonly PartitionColumn[]
  gapXs: readonly GapExtent[]
  boundariesByBodyId: ReadonlyMap<string, BodyBoundaryResponse> | undefined
  alongToScreenX: ((along: number) => number) | undefined
  screenToLevel: ((y: number) => number) | undefined
  lensDrag: LensDragState | null
  boundaryDrag: ContactDragState | null
  /**
   * ``gapIndex:bodyId`` for TWO-SIDED bodies whose STORED (persisted) in-gap node is a
   * genuine LENS tip, NOT a shared-contact bend (§91). The caller (``PartitionFillOverlay``)
   * derives this from an engine-truth base pass: a two-sided body that owns an
   * apex-shapeable lens region whose elevation span contains the stored node is
   * shaping a lens, so its node must route through the ``bodyId@gap`` LENS apex path —
   * NOT the ``contact:U|L@g`` path — EVEN WITH NO LIVE DRAG. Without this, the live
   * lens drag reshapes (the §88 branch fires) but on RELEASE the memo rebuilds with
   * ``lensDrag = null`` → the same node routes as an un-routable contact override →
   * floods to a band → the reshape SNAPS BACK. This set makes the persisted routing
   * match the live routing so a safe lens drag persists visibly. ``undefined`` (the
   * legacy caller) preserves the pre-§91 behaviour exactly.
   */
  persistedLensBodies?: ReadonlySet<string>
}

/** Output: the override map + the set of gap-scoped bodies whose contact was overridden. */
export interface ApexOverrideResult {
  apexOverrides: Map<string, LensApexOverride>
  /** ``gapIndex:upperBodyId`` for each two-band contact override written. */
  contactOverriddenBodies: Set<string>
}

/**
 * Build the lens apex + two-band contact overrides for every gap.
 *
 * Replicates the ``sectionFillData`` memo's override loop verbatim, plus the §88
 * fix: a two-sided band that is the LIVE lens-drag target (and owns a lens node in
 * the gap) also gets its ``bodyId@gap`` apex override, and the contact path skips
 * that exact body in that gap so its node is never applied twice.
 *
 * Parameters
 * ----------
 * inputs : ApexOverrideInputs
 *     A pure snapshot of the memo's closure (columns, gap extents, stored boundary
 *     shapes, the two screen transforms, the two live drag states, engine flag).
 *
 * Returns
 * -------
 * ApexOverrideResult
 *     ``apexOverrides`` — the ``bodyId@gap`` (lens) and ``contact:U|L@g`` (contact)
 *     override map fed to the engine; ``contactOverriddenBodies`` — the
 *     ``gapIndex:upperBodyId`` set the caller uses to gate the off-engine reshape.
 */
export function buildApexOverridesForGaps(inputs: ApexOverrideInputs): ApexOverrideResult {
  const {
    orderedColumns,
    gapXs,
    boundariesByBodyId,
    alongToScreenX,
    screenToLevel,
    lensDrag,
    boundaryDrag,
    persistedLensBodies,
  } = inputs

  const apexOverrides = new Map<string, LensApexOverride>()
  const contactOverriddenBodies = new Set<string>()

  for (let i = 0; i < orderedColumns.length - 1; i += 1) {
    const { leftX, rightX } = gapXs[i]
    if (rightX <= leftX || !alongToScreenX) continue
    const gapW = rightX - leftX
    const left = orderedColumns[i]
    const right = orderedColumns[i + 1]
    const leftIds = new Set(left.units.map((u) => u.bodyId).filter((id): id is string => !!id))
    const rightIds = new Set(right.units.map((u) => u.bodyId).filter((id): id is string => !!id))

    // Owned nodes → gap-local (fraction, elevation); the node being dragged takes
    // the live cursor position so the domain rebuilds the lens in real time.
    const chain = (
      nodes: readonly BodyBoundaryNode[],
      bodyId: string,
      edge: 'upper' | 'lower',
    ): { fraction: number; elevation: number }[] => {
      const chainOut: { fraction: number; elevation: number }[] = []
      nodes.forEach((n, ni) => {
        const x = alongToScreenX!(n.along_m)
        if (x < leftX - NODE_OWN_EPS || x > rightX + NODE_OWN_EPS) return // neighbour gap's node
        const dragging =
          !!lensDrag &&
          lensDrag.bodyId === bodyId &&
          Math.abs(lensDrag.leftX - leftX) < 0.5 &&
          lensDrag.edge === edge &&
          lensDrag.nodeIndex === ni
        if (dragging) {
          chainOut.push({
            fraction: clamp01((lensDrag.x - leftX) / gapW),
            elevation: screenToLevel ? screenToLevel(lensDrag.y) : n.elevation_m,
          })
        } else {
          chainOut.push({ fraction: clamp01((x - leftX) / gapW), elevation: n.elevation_m })
        }
      })
      // S86 press-to-grab: a NEW node created on mousedown is not yet in ``nodes``, so
      // it has no slot the loop above can override. INJECT it from the live cursor on
      // the edge it was created on so the new node reshapes on the SAME press-drag. The
      // mouseup APPENDS the node to this edge, so from the next render it is an ordinary
      // stored node handled by the loop above (``isNew`` absent). Guarded on the exact
      // (body, gap, edge) so it never bleeds into a sibling body/edge.
      const injectNew =
        !!lensDrag &&
        lensDrag.isNew === true &&
        lensDrag.bodyId === bodyId &&
        Math.abs(lensDrag.leftX - leftX) < 0.5 &&
        lensDrag.edge === edge
      if (injectNew) {
        chainOut.push({
          fraction: clamp01((lensDrag!.x - leftX) / gapW),
          elevation: screenToLevel ? screenToLevel(lensDrag!.y) : 0,
        })
      }
      return chainOut
    }

    const setShape = (bodyId: string): void => {
      const b = boundariesByBodyId?.get(bodyId)
      // S86 press-to-grab: a body may own NO stored boundary yet when its FIRST node is
      // created on the add-strip press. ``chain`` injects the new node from the live
      // cursor, so proceed with empty stored arrays when THIS body/gap is the ``isNew``
      // drag target — otherwise the first-ever node would build no live override and the
      // new node would not reshape until it persisted (the old two-step gesture).
      const isNewHere =
        !!lensDrag &&
        lensDrag.isNew === true &&
        lensDrag.bodyId === bodyId &&
        Math.abs(lensDrag.leftX - leftX) < 0.5
      if (!b && !isNewHere) return
      const upper = chain(b?.upper_nodes ?? [], bodyId, 'upper')
      const lower = chain(b?.lower_nodes ?? [], bodyId, 'lower')
      if (upper.length + lower.length === 0) return // no owned node → domain default apex
      // TOP-LEVEL APEX = the reach the engine reads as the lens tip (``ov.fraction`` /
      // ``ov.elevation``). It MUST ride the edge the owner is actively dragging — not the
      // unconditional ``upper[0]`` (S84 root cause). A tall two-sided band can carry a STALE
      // UPPER contact node near the section top AND the LOWER lens node being dragged;
      // ``upper[0] ?? lower[0]`` then pinned the apex to the top node (el≈11.7 in the owner's
      // ...934a78 gap-5 dogfeed) whatever edge was grabbed, so the tip flooded to the section
      // top → an unsafe reach → rejected → snapback (nothing persisted). Prefer the dragged
      // edge's first node when THIS body is the live lens-drag target in THIS gap; otherwise
      // keep the legacy upper-then-lower precedence (the non-drag render path, unchanged).
      const draggingThisBody =
        !!lensDrag &&
        lensDrag.bodyId === bodyId &&
        Math.abs(lensDrag.leftX - leftX) < 0.5
      const draggedEdgeFirst = draggingThisBody
        ? lensDrag!.edge === 'lower'
          ? (lower[0] ?? upper[0])
          : (upper[0] ?? lower[0])
        : undefined
      const apex0 = draggedEdgeFirst ?? upper[0] ?? lower[0]
      // S97 OVER-REACH signal (collapse discriminator): the RAW (pre-clamp) apex reach of the live
      // cursor, in gap-local fraction. ``fraction`` above is clamped to a visible in-gap value
      // (``clampVisibleApex``), which DISCARDS whether the user dragged the apex PAST a column edge;
      // ``rawApexFraction`` preserves it (> 1 = past the far column, < 0 = past the anchor). Set ONLY
      // when THIS body is the live lens-drag target in THIS gap (the cursor IS the reach) — the
      // non-drag / persisted-render path leaves it absent so it never trips the collapse rule.
      const rawApexFraction = draggingThisBody ? (lensDrag!.x - leftX) / gapW : undefined
      apexOverrides.set(lensApexOverrideKey(bodyId, i), {
        // Floor the apex reach to a VISIBLE fraction (S72) — see clampVisibleApex.
        fraction: clampVisibleApex(apex0.fraction),
        elevation: apex0.elevation,
        upper,
        lower,
        ...(rawApexFraction !== undefined ? { rawApexFraction } : {}),
      })
    }

    for (const id of leftIds) if (!rightIds.has(id)) setShape(id)
    for (const id of rightIds) if (!leftIds.has(id)) setShape(id)

    // §88 / §91 FIX — a TWO-SIDED band (present on BOTH columns, so skipped by the two
    // XOR loops above) can still own a genuine LENS tip inside this gap. Its
    // ``bodyId@gap`` apex override must be built (never the contact path) in TWO cases:
    //   • §88 — the LIVE lens drag targets this body in this gap (reshape follows the
    //     cursor). Without it the drag produces NO override and nothing reshapes.
    //   • §91 — NO live drag, but this body's PERSISTED in-gap node is an engine-
    //     confirmed lens tip (in ``persistedLensBodies``). Without it the memo rebuild
    //     after mouseup routes the stored node through the contact path (un-routable →
    //     flood) → the live reshape SNAPS BACK on release.
    // ``setShape`` self-filters (early-returns when the body owns no in-gap node), so
    // this is a no-op for a two-sided body with no lens node here. The set of bodies
    // to disentangle from the contact path is collected so their node is never applied
    // twice (once as a lens apex, once as a contact bend). The drag/persist KIND (lens)
    // decides, not the body's two-sidedness (which reads as a contact by geometry alone).
    const lensBodiesThisGap = new Set<string>()
    const routeAsLens = (bodyId: string): void => {
      if (!leftIds.has(bodyId) || !rightIds.has(bodyId)) return // not two-sided here
      const key = lensApexOverrideKey(bodyId, i)
      const before = apexOverrides.has(key)
      setShape(bodyId)
      // Only claim the disentangle when the lens override was actually written (the
      // body owns a lens node here) — a bare route over a contact-only body must not
      // suppress its legitimate contact override.
      if (!before && apexOverrides.has(key)) lensBodiesThisGap.add(bodyId)
    }
    if (lensDrag && lensDrag.gapIndex === i) routeAsLens(lensDrag.bodyId)
    if (persistedLensBodies) {
      for (const id of persistedLensBodies) {
        // Keyed ``gapIndex:bodyId``; only process this gap's entries.
        const at = id.indexOf(':')
        if (at < 0) continue
        if (Number(id.slice(0, at)) !== i) continue
        routeAsLens(id.slice(at + 1))
      }
    }

    // Matched TWO-BAND CONTACT free-draw (S68): a node stored on a full-width band's
    // ``lower_nodes`` shapes the shared contact between it and the band below. Only
    // the v2 engine consumes ``contact:U|L@g``. §88 disentangle: skip the body being
    // dragged as a LENS tip in this gap so its node is never applied twice (once as a
    // lens apex, once as a contact bend) — the drag KIND (lens) decides, not the
    // body's two-sidedness (which classifies it as a contact by geometry alone).
    {
      const gapOverridden = collectContactOverridesForGap(
        i,
        left,
        right,
        leftX,
        rightX,
        boundariesByBodyId,
        alongToScreenX,
        screenToLevel,
        boundaryDrag,
        apexOverrides,
        lensBodiesThisGap.size > 0 ? lensBodiesThisGap : null,
      )
      for (const id of gapOverridden) contactOverriddenBodies.add(`${i}:${id}`)
    }
  }

  return { apexOverrides, contactOverriddenBodies }
}

/**
 * Detect two-sided bodies whose STORED (persisted) in-gap node is a genuine LENS tip
 * — the §91 engine-truth discriminator for the ``persistedLensBodies`` input above.
 *
 * The problem it solves: BOTH the lens-edge drag and the shared-contact drag persist a
 * node onto the SAME ``lower_nodes`` array, so the node's KIND is not recoverable from
 * storage alone. On the memo rebuild after a lens-drag mouseup (``lensDrag = null``) a
 * two-sided body's node would route through the contact path (un-routable → flood) and
 * the live reshape snaps back. This function recovers the KIND from ENGINE TRUTH: a
 * two-sided body that owns an APEX-SHAPEABLE lens region in a gap (an interior tip, not
 * a full-width band) AND whose stored in-gap node sits INSIDE that region's elevation
 * span is shaping that lens tip — its node must route through the lens path. A genuine
 * shared-contact bend sits at the full-width band's BASE contact (outside the tip
 * region's span), so it is NOT flagged and keeps routing through the contact path.
 *
 * Pure: takes the base-fill regions (no overrides) the caller already computes.
 *
 * Parameters
 * ----------
 * baseRegions : readonly SectionRegion[]
 *     The no-override base partition (``computeSectionFillActive(cols, edges, undefined,
 *     alongM)``). Each region carries ``bodyId`` + ``gapIndex`` + a fraction×elevation
 *     ``polygon``.
 * orderedColumns : readonly PartitionColumn[]
 *     The section columns (to test two-sidedness per gap).
 * boundariesByBodyId : ReadonlyMap<string, BodyBoundaryResponse> | undefined
 *     Stored per-body boundary shapes (the persisted node source).
 * alongToScreenX : ((along: number) => number) | undefined
 *     Along-metres → screen x (for node in-gap ownership).
 * gapXs : readonly GapExtent[]
 *     Per-gap screen x-extents (1:1 with the gaps between ``orderedColumns``).
 *
 * Returns
 * -------
 * Set<string>
 *     ``gapIndex:bodyId`` for every two-sided body whose persisted node is a lens tip.
 */
export function detectPersistedLensBodies(
  baseRegions: readonly SectionRegion[],
  orderedColumns: readonly PartitionColumn[],
  boundariesByBodyId: ReadonlyMap<string, BodyBoundaryResponse> | undefined,
  alongToScreenX: ((along: number) => number) | undefined,
  gapXs: readonly GapExtent[],
): Set<string> {
  const out = new Set<string>()
  if (!boundariesByBodyId || !alongToScreenX) return out

  // Elevation span of every apex-shapeable region per ``gapIndex:bodyId``. A body can
  // own several shapeable tips in a gap; union their spans so a node inside ANY tip is
  // recognised.
  const tipSpan = new Map<string, { min: number; max: number }>()
  for (const r of baseRegions) {
    if (r.bodyId == null || !isApexShapeable(r)) continue
    let lo = Infinity
    let hi = -Infinity
    for (const p of r.polygon) {
      if (p.elevation < lo) lo = p.elevation
      if (p.elevation > hi) hi = p.elevation
    }
    const key = `${r.gapIndex}:${r.bodyId}`
    const prev = tipSpan.get(key)
    tipSpan.set(key, prev ? { min: Math.min(prev.min, lo), max: Math.max(prev.max, hi) } : { min: lo, max: hi })
  }
  if (tipSpan.size === 0) return out

  for (let i = 0; i < orderedColumns.length - 1 && i < gapXs.length; i += 1) {
    const { leftX, rightX } = gapXs[i]
    if (rightX <= leftX) continue
    const left = orderedColumns[i]
    const right = orderedColumns[i + 1]
    const leftIds = new Set(left.units.map((u) => u.bodyId).filter((id): id is string => !!id))
    const rightIds = new Set(right.units.map((u) => u.bodyId).filter((id): id is string => !!id))
    for (const bodyId of leftIds) {
      if (!rightIds.has(bodyId)) continue // only two-sided bodies risk the contact-path misroute
      const span = tipSpan.get(`${i}:${bodyId}`)
      if (!span) continue // no shapeable lens tip here → a genuine contact-only body
      const bnd = boundariesByBodyId.get(bodyId)
      if (!bnd) continue
      // Any stored in-gap node (either edge) whose elevation sits inside the tip span
      // → the node is shaping the lens tip, not the shared contact.
      const nodes = [...(bnd.upper_nodes ?? []), ...(bnd.lower_nodes ?? [])]
      const routesAsLens = nodes.some((n) => {
        const x = alongToScreenX(n.along_m)
        if (x < leftX - NODE_OWN_EPS || x > rightX + NODE_OWN_EPS) return false
        return n.elevation_m >= span.min - CONTACT_MATCH_M && n.elevation_m <= span.max + CONTACT_MATCH_M
      })
      if (routesAsLens) out.add(`${i}:${bodyId}`)
    }
  }
  return out
}
