/**
 * unsafeDragUX.ts — the pure decision primitives for the owner's "red handle and snapback" UX.
 *
 * When a live free-draw drag (lens apex or matched boundary) reaches a position the partition engine
 * REJECTS as unsafe (would open a gap or overlap), Session-79 exposed a structured outcome whose
 * ``status`` is ``'rejected-unsafe'`` (see ``computeSectionFillV2.classifyOverrideOutcome``). The
 * engine keeps "never a gap or overlap" BY CONSTRUCTION by rendering the un-reshaped BASE fill on
 * such a frame — so the visible body already sits at its last SAFE shape. This module turns that
 * per-frame status into the two owner-chosen UX responses:
 *
 *   - RED HANDLE while rejected — clear feedback that the spot is refused.
 *   - SNAP BACK on release — the unsafe node is discarded (never persisted); the handle returns to
 *     the last applied geometry (which the base fill already renders).
 *
 * These are pure functions so the god-component (``PartitionFillOverlay``) only wires them; the
 * decision logic is unit-tested in isolation (``unsafeDragUX.rules.test.ts``).
 */

/** The tri-state a free-draw override pass reports (Session-79 ``OverrideOutcome['status']``). */
export type OverrideStatus = 'applied' | 'rejected-unsafe' | 'unsupported'

/**
 * The EXACT editable target a free-draw gesture operates on (§87 BUG #1 fix).
 *
 * The visible marker, the persisted node, the raw engine emitter, the safety result, and the red
 * rejection must all refer to the SAME editable target — never just a ``bodyId``. A rendered body
 * carries MANY handles (a lens's upper + lower edge nodes, several stacked tips across gaps, and its
 * shared-boundary contact when it is a full-width band), so a body-level rejection reddens all of
 * them at once (the "MANY/ALL markers turn red" dogfeed, measured 9 sibling handles on real CS1).
 * This discriminated union pins the ONE node a drag owns:
 *
 *   - ``lens``     — a node on a lens/pinch edge polyline: ``bodyId`` + ``gapIndex`` (a two-gap lens
 *                    renders a copy per gap) + ``edge`` (upper/lower) + ``nodeIndex``.
 *   - ``boundary`` — a node on a shared contact between two full-width bands: the ``upperBodyId`` +
 *                    ``lowerBodyId`` pair + ``gapIndex`` + ``nodeIndex``.
 *
 * ``regionIdx`` is deliberately NOT part of the identity: it is an ephemeral index into the
 * per-frame ``screenRegions`` array that changes as the partition regenerates mid-drag; the stable
 * identity is (body, gap, edge, node). The drag-state ``regionIdx`` still discriminates which
 * on-screen COPY renders the live handle, but the OWNERSHIP identity must survive re-render.
 */
export type EditableTargetIdentity =
  | { kind: 'lens'; bodyId: string; gapIndex: number; edge: 'upper' | 'lower'; nodeIndex: number }
  | { kind: 'boundary'; upperBodyId: string; lowerBodyId: string; gapIndex: number; nodeIndex: number }

/**
 * Are two editable-target identities the SAME exact node? Byte-for-byte on every discriminating
 * field (never a bodyId-only match). ``null`` on either side → not equal.
 *
 * This is THE canonical equality helper the §87 brief mandates — used for active-drag render, red
 * rejection render, release/snap-back, and diagnostics, so all five references agree on one target.
 *
 * Parameters
 * ----------
 * a, b : EditableTargetIdentity | null | undefined
 *     The two identities to compare (the render-site handle's identity and the rejected-drag target).
 *
 * Returns
 * -------
 * bool
 *     ``true`` only when both are present, the same ``kind``, and every field matches.
 */
export function sameEditableTarget(
  a: EditableTargetIdentity | null | undefined,
  b: EditableTargetIdentity | null | undefined,
): boolean {
  if (a == null || b == null) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'lens' && b.kind === 'lens') {
    return a.bodyId === b.bodyId && a.gapIndex === b.gapIndex && a.edge === b.edge && a.nodeIndex === b.nodeIndex
  }
  if (a.kind === 'boundary' && b.kind === 'boundary') {
    return (
      a.upperBodyId === b.upperBodyId &&
      a.lowerBodyId === b.lowerBodyId &&
      a.gapIndex === b.gapIndex &&
      a.nodeIndex === b.nodeIndex
    )
  }
  return false
}

/**
 * Handle colour for a rendered handle given the EXACT rejected-drag target (§87 BUG #1 fix).
 *
 * Red ONLY when this handle's identity IS the rejected target (``sameEditableTarget``), so a sibling
 * handle of the same body — its other lens edge, another gap's tip, its shared-boundary contact —
 * stays its normal colour. Supersedes the body-level ``handleFillColor``, which reddened every
 * handle sharing the dragged body's id.
 *
 * Parameters
 * ----------
 * handle : EditableTargetIdentity
 *     The identity of the handle being rendered.
 * rejectedTarget : EditableTargetIdentity | null
 *     The exact target currently being dragged into a rejected reach (``null`` when the drag is
 *     safe / absent — so nothing reddens).
 * normalColor : str
 *     The handle's normal fill (``LENS_COLOR`` amber / ``BOUNDARY_COLOR`` sky-blue).
 *
 * Returns
 * -------
 * str
 *     ``REJECT_COLOR`` when ``handle`` IS ``rejectedTarget``, else ``normalColor``.
 */
export function handleColorForTarget(
  handle: EditableTargetIdentity,
  rejectedTarget: EditableTargetIdentity | null,
  normalColor: string,
): string {
  return sameEditableTarget(handle, rejectedTarget) ? REJECT_COLOR : normalColor
}

/**
 * Handle colour for a REJECTED drag — red-600 (``#dc2626``), the established danger-stroke hue used
 * across the section overlays (``ContactPickBar`` / ``HoverReadoutCard`` / ``BoreholeColumn``). It
 * reads clearly against both the amber lens handles and the sky-blue boundary handles.
 */
export const REJECT_COLOR = '#dc2626'

/**
 * Is the current live-drag outcome an unsafe rejection?
 *
 * Parameters
 * ----------
 * status : OverrideStatus | null | undefined
 *     The per-frame override outcome status (``null`` when no drag / no override is active).
 *
 * Returns
 * -------
 * bool
 *     ``true`` only for ``'rejected-unsafe'``; ``'applied'`` / ``'unsupported'`` / absent → ``false``.
 */
export function isDragRejected(status: OverrideStatus | null | undefined): boolean {
  return status === 'rejected-unsafe'
}

/**
 * Should the drag PERSIST on release, or snap back?
 *
 * A ``'rejected-unsafe'`` release must NOT persist the unsafe node — the overlay snaps the handle
 * back to the last applied (safe) geometry. Every other status persists as today: ``'applied'`` is a
 * genuine safe reshape, and ``'unsupported'`` (no override present, or the stable v1 engine which has
 * no rejection model) keeps the pre-existing save behaviour.
 *
 * Parameters
 * ----------
 * status : OverrideStatus | null | undefined
 *     The override outcome status at release time.
 *
 * Returns
 * -------
 * bool
 *     ``false`` only for ``'rejected-unsafe'`` (snap back); ``true`` otherwise (persist normally).
 */
export function shouldPersistDrag(status: OverrideStatus | null | undefined): boolean {
  return !isDragRejected(status)
}
