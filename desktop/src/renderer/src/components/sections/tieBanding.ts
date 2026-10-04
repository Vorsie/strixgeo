/**
 * Whether an accepted tie's two bands are one body — "identity follows the drawing".
 *
 * Owner ruling 2026-10-04, verbatim *"b, identity follows the drawing"*: bands are
 * one body ONLY where the section fill paints them as one mass. The backend
 * resolver unions only the geometry facts the renderer posts at
 * ``bodies/recompute``; an accepted tie that the fill does not paint as a band
 * (the CS4 case: one top tie in the sub-TD zone, no base tie, so no band) joins
 * nothing and stays a surface statement. The section says so on the tie, so the
 * engineer is not left wondering why the Parameters tree lists two bodies.
 *
 * This module only READS the stamped ``body_id``s the resolver wrote. It never
 * re-derives identity, so it cannot disagree with the database.
 *
 * Pure module — no React, no I/O.
 */

/** The banding state of an accepted tie, or ``null`` when the section makes no statement. */
export type TieBanding = 'banded' | 'not_banded' | null

/** The formation fields the mass key reads. */
export interface MassKeySource {
  id: string
  nad_class: number | null
  source_litho_formation_id: string | null
}

/**
 * The mass a band belongs to — the client mirror of the resolver's ``same_mass``.
 *
 * A litho band's mass is its litho UNIT, i.e. its own formation row (owner
 * 2026-10-03: ZAND and ZAND (SL:M) are two lithologies, never one body). A packing
 * band's mass is its litho unit + NAD class: the model keeps one formation row per
 * (class, litho parent, geological parent), so two rows of one class inside one
 * unit are still one mass (owner 2026-08-21).
 *
 * Parameters
 * ----------
 * f : MassKeySource | undefined
 *     The band's formation row.
 *
 * Returns
 * -------
 * string | null
 *     A key that is equal for two bands that CAN be one body, or ``null`` when the
 *     formation is unknown.
 */
export function massKeyOfFormation(f: MassKeySource | undefined): string | null {
  if (f === undefined) return null
  if (f.nad_class !== null) return `class:${f.source_litho_formation_id ?? '?'}:${f.nad_class}`
  return `row:${f.id}`
}

/** Inputs of {@link tieBandingStatus}. */
export interface TieBandingArgs {
  /** Whether the tie is accepted (a pending proposal states nothing). */
  approved: boolean
  /** Stamped ``body_id`` of the band at end A (``null``/``undefined`` = unknown). */
  bodyA: string | null | undefined
  /** Stamped ``body_id`` of the band at end B. */
  bodyB: string | null | undefined
  /** {@link massKeyOfFormation} of end A. */
  massA: string | null
  /** {@link massKeyOfFormation} of end B. */
  massB: string | null
}

/**
 * Classify an accepted tie as banded (one body) or not banded (two bodies).
 *
 * Only a tie whose two bands CAN be one mass gets a statement: a tie across two
 * units or two packing classes is never one body by design (a surface tie), and a
 * pending proposal or an unstamped band has nothing to report.
 *
 * Parameters
 * ----------
 * args : TieBandingArgs
 *     The tie's approval, the two stamped body ids and the two mass keys.
 *
 * Returns
 * -------
 * TieBanding
 *     ``'banded'`` when both bands share a body, ``'not_banded'`` when the fill
 *     left them two bodies, ``null`` when no statement applies.
 */
export function tieBandingStatus(args: TieBandingArgs): TieBanding {
  const { approved, bodyA, bodyB, massA, massB } = args
  if (!approved) return null
  if (massA === null || massB === null || massA !== massB) return null
  if (bodyA == null || bodyB == null) return null
  return bodyA === bodyB ? 'banded' : 'not_banded'
}
