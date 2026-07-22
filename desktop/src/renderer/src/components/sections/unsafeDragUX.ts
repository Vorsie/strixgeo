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
 * Choose a handle's fill colour: red when THIS body is the one being dragged into a rejected reach,
 * otherwise its normal colour. Only the actively-dragged body is ever recoloured (the caller passes
 * ``rejectedDragBody = null`` unless the live drag's outcome is ``rejected-unsafe``), so a
 * non-dragged handle is never tinted.
 *
 * Parameters
 * ----------
 * bodyId : str
 *     The body this handle belongs to.
 * rejectedDragBody : str | null
 *     The bodyId currently being dragged whose live outcome is ``rejected-unsafe`` (``null`` when the
 *     drag is safe / absent).
 * normalColor : str
 *     The handle's normal fill (``LENS_COLOR`` amber / ``BOUNDARY_COLOR`` sky-blue).
 *
 * Returns
 * -------
 * str
 *     ``REJECT_COLOR`` when ``bodyId === rejectedDragBody``, else ``normalColor``.
 */
export function handleFillColor(
  bodyId: string,
  rejectedDragBody: string | null,
  normalColor: string,
): string {
  return rejectedDragBody != null && bodyId === rejectedDragBody ? REJECT_COLOR : normalColor
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
