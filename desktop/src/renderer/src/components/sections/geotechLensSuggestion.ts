/**
 * Small enclosed class-lens detection — the "merge into surrounding band" suggestion.
 *
 * Owner idea (CS1 brainstorm, docs/debt.md #227 tail): tiny enclosed packing-class
 * lenses — a thin band of class X fully inside a host stack of class Y — get an
 * affordance suggesting the absorb, mirroring the litho stage's assisted-manual
 * philosophy: the system POINTS, the engineer ACTS. Detection gates only the
 * affordance; the server never checks smallness or host-class equality (its refusals
 * stay hierarchy/structural — ruling 5), and accepting the suggestion is ONE
 * merge call over the ``[upperHost, lens, lowerHost]`` run, so the consequence
 * sheet shows one honest union preview and undo is one step.
 *
 * The smallness threshold is the model's OWN ``minimumLayerThicknessM`` preference
 * (the "thinnest NAD packing band kept" knob of the subdivision prefs) — no new
 * magic number; the model already states what "too thin" means.
 *
 * Deliberately out of scope, recorded: multi-band lens runs (host, lensA, lensB,
 * host) — single-band lenses only; the litho-level thin-interbed analogue the debt
 * text mentions is a separate later slice against litho ghosts.
 *
 * Pure — no React, no network — so the rule is testable on its own.
 */

import {
  type DepthInterval,
  type GeotechBandInterval,
  canMergeBands,
} from './geotechBandEdit'

/** A qualifying lens: the thin band plus the two same-class hosts around it. */
export interface EnclosedLens {
  upperHost: GeotechBandInterval
  lens: GeotechBandInterval
  lowerHost: GeotechBandInterval
  /** The hosts' shared, non-null NAD class — the matrix the absorb restores. */
  hostClass: number
  /** The lens's own class; ``null`` for an unclassifiable sliver. */
  lensClass: number | null
}

/**
 * Judge whether ``bands[index]`` is an enclosed class lens.
 *
 * Qualifies when ALL of:
 * 1. both neighbours exist (a band with one same-body neighbour is a pair
 *    merge, already served by the merge handle);
 * 2. both boundaries are legal merges (``canMergeBands`` — adjacency + same
 *    litho body, so a "lens" against a litho contact is structurally
 *    excluded, ruling 2 for free);
 * 3. both hosts carry the SAME, non-null NAD class;
 * 4. the lens class differs — INCLUDING ``null`` (an unclassifiable sliver
 *    between matching hosts is the best absorb candidate of all).
 *
 * Thickness is judged by the caller (:func:`findSmallEnclosedLenses`) so a
 * menu opened on any band can still name the enclosure without the size gate.
 *
 * @param bands The column's packing bands, sorted top to bottom.
 * @param index The band to judge.
 * @param lithoBodies The column's litho bodies (the hard walls).
 * @param nadClassByFormationId ``formation_id → nad_class`` (a miss reads as
 *   no class, which suppresses the suggestion — safe degradation).
 * @returns The enclosure, or ``null`` when the band is not an enclosed lens.
 */
export function enclosedLensAt(
  bands: readonly GeotechBandInterval[],
  index: number,
  lithoBodies: readonly DepthInterval[],
  nadClassByFormationId: ReadonlyMap<string, number | null>,
): EnclosedLens | null {
  const lens = bands[index]
  if (lens === undefined) return null
  const upperHost = index > 0 ? bands[index - 1] : undefined
  const lowerHost = index < bands.length - 1 ? bands[index + 1] : undefined
  if (upperHost === undefined || lowerHost === undefined) return null
  if (!canMergeBands(upperHost, lens, lithoBodies).ok) return null
  if (!canMergeBands(lens, lowerHost, lithoBodies).ok) return null
  const upperClass = nadClassByFormationId.get(upperHost.formationId) ?? null
  const lowerClass = nadClassByFormationId.get(lowerHost.formationId) ?? null
  if (upperClass === null || upperClass !== lowerClass) return null
  const lensClass = nadClassByFormationId.get(lens.formationId) ?? null
  if (lensClass === upperClass) return null
  return { upperHost, lens, lowerHost, hostClass: upperClass, lensClass }
}

/**
 * Every SMALL enclosed lens on a column, top to bottom.
 *
 * @param bands The column's packing bands, sorted top to bottom.
 * @param lithoBodies The column's litho bodies.
 * @param nadClassByFormationId ``formation_id → nad_class``.
 * @param minimumLayerThicknessM The model's "thinnest packing band kept" pref —
 *   a lens at or under it is small enough to suggest absorbing.
 * @returns The qualifying lenses, in band order.
 */
export function findSmallEnclosedLenses(
  bands: readonly GeotechBandInterval[],
  lithoBodies: readonly DepthInterval[],
  nadClassByFormationId: ReadonlyMap<string, number | null>,
  minimumLayerThicknessM: number,
): EnclosedLens[] {
  const out: EnclosedLens[] = []
  for (let i = 0; i < bands.length; i++) {
    const thickness = bands[i].baseDepthM - bands[i].topDepthM
    if (thickness > minimumLayerThicknessM) continue
    const lens = enclosedLensAt(bands, i, lithoBodies, nadClassByFormationId)
    if (lens !== null) out.push(lens)
  }
  return out
}
