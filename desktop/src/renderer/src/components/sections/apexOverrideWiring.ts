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
} from '../../utils/partitionFill'
import { collectContactOverridesForGap, type ContactDragState } from './contactOverrideWiring'

/**
 * Ownership epsilon (screen px): a node whose projected x sits within this
 * distance of a gap edge still counts as owned by that gap. Mirrors the overlay's
 * ``NODE_OWN_EPS`` (kept in sync — a sub-px change either way is a render seam, not
 * a functional change).
 */
const NODE_OWN_EPS = 0.5

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
  /** Whether the v2 engine (the ``contact:`` consumer) is active. */
  partitionEngineV2: boolean
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
    partitionEngineV2,
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
      return chainOut
    }

    const setShape = (bodyId: string): void => {
      const b = boundariesByBodyId?.get(bodyId)
      if (!b) return
      const upper = chain(b.upper_nodes ?? [], bodyId, 'upper')
      const lower = chain(b.lower_nodes ?? [], bodyId, 'lower')
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
      apexOverrides.set(lensApexOverrideKey(bodyId, i), {
        // Floor the apex reach to a VISIBLE fraction (S72) — see clampVisibleApex.
        fraction: clampVisibleApex(apex0.fraction),
        elevation: apex0.elevation,
        upper,
        lower,
      })
    }

    for (const id of leftIds) if (!rightIds.has(id)) setShape(id)
    for (const id of rightIds) if (!leftIds.has(id)) setShape(id)

    // §88 FIX — a TWO-SIDED band (present on BOTH columns, so skipped by the two
    // XOR loops above) can still own a genuine LENS tip inside this gap. When the
    // live lens drag targets such a body IN THIS GAP, build its ``bodyId@gap`` apex
    // override too — otherwise the drag produces NO override and nothing reshapes
    // (the definitive "manual reshape does nothing" root cause). ``setShape`` self-
    // filters (early-returns when the body owns no in-gap lens node), so this is a
    // no-op for a two-sided body being dragged only on its shared contact.
    let lensDragBodyThisGap: string | null = null
    if (lensDrag && lensDrag.gapIndex === i && leftIds.has(lensDrag.bodyId) && rightIds.has(lensDrag.bodyId)) {
      const before = apexOverrides.has(lensApexOverrideKey(lensDrag.bodyId, i))
      setShape(lensDrag.bodyId)
      // Only claim the disentangle when the lens override was actually written (the
      // body owns a lens node here) — a bare drag over a contact-only body must not
      // suppress its legitimate contact override.
      if (!before && apexOverrides.has(lensApexOverrideKey(lensDrag.bodyId, i))) {
        lensDragBodyThisGap = lensDrag.bodyId
      }
    }

    // Matched TWO-BAND CONTACT free-draw (S68): a node stored on a full-width band's
    // ``lower_nodes`` shapes the shared contact between it and the band below. Only
    // the v2 engine consumes ``contact:U|L@g``. §88 disentangle: skip the body being
    // dragged as a LENS tip in this gap so its node is never applied twice (once as a
    // lens apex, once as a contact bend) — the drag KIND (lens) decides, not the
    // body's two-sidedness (which classifies it as a contact by geometry alone).
    if (partitionEngineV2) {
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
        lensDragBodyThisGap,
      )
      for (const id of gapOverridden) contactOverriddenBodies.add(`${i}:${id}`)
    }
  }

  return { apexOverrides, contactOverriddenBodies }
}
