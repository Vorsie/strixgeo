/**
 * partitionFillV2/expandOverrideAliases.ts — resolve the render-bodyId ↔ emit-bodyId mismatch for
 * free-draw apex overrides (SESSION 75, owner 2026-07-22 THIRD engine grant "make every handle
 * reshape").
 *
 * THE MISMATCH. The app keys a grab handle (and its override) on the RENDERED region's bodyId, which
 * is the POST-``mergeTouchingBodies`` representative — the smallest-ordered raw body in a same-litho
 * touching component. The engine emits per RAW unit and consumes the raw bodyId DURING emission
 * (before the merge). In a single-lithology section the merge unions MANY raw bodies (across gaps)
 * under one representative, so the app's handle key rarely equals the emitting raw body → the override
 * is never consumed and the handle is DEAD (S67 wall, measured on real CS1: a gap-9 tip emitted by
 * ``019ea3e1`` renders under ``019ea170`` whose raw unit lives on col 0).
 *
 * THE FIX. A no-override BASE PASS reveals the EXACT render→raw equivalence (the merge only relabels —
 * never moves a vertex — so the base pass's ``sliced`` [raw bodyIds] vs merged [rendered bodyIds]
 * regions, matched by identical polygon, give the authoritative grouping). For each incoming override
 * ``renderBody@gap`` we ALIAS it to every RAW body sharing that rendered body's component, so whichever
 * raw unit emits the tip finds the override under ITS OWN bodyId. Aliases fill only empty slots, so an
 * explicit override on the true emitting body wins. NO override → the map is returned UNCHANGED and the
 * base pass is skipped (single pass, byte-identical). The base pass carries UNDEFINED overrides, so it
 * never recurses.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { lensApexOverrideKey, type LensApexOverride, type PartitionPoint, type SectionRegion } from '../sectionPartition'

/** A stable key for a region's polygon (merge never moves a vertex, so raw↔merged share it). */
function polygonKey(poly: readonly PartitionPoint[]): string {
  return poly.map((p) => `${p.fraction.toFixed(5)},${p.elevation.toFixed(5)}`).join(';')
}

/**
 * Expand a section's apex-override map with render→raw body ALIASES, using a no-override base pass to
 * learn the exact ``mergeTouchingBodies`` equivalence.
 *
 * Returns the ORIGINAL overrides unchanged (no base pass) when there are no overrides. Otherwise runs
 * ``basePass`` (a no-override fill returning both the RAW-body ``sliced`` regions and the RENDERED
 * merged regions) and, for each override ``renderBody@gap``, aliases it to every raw body in the
 * rendered body's component.
 *
 * Parameters
 * ----------
 * overrides : ReadonlyMap<string, LensApexOverride> | undefined
 *     The section's per-(render body, gap) apex overrides.
 * basePass : () => { sliced: SectionRegion[]; merged: SectionRegion[] }
 *     A no-override fill of THIS section — ``sliced`` carries raw pre-merge bodyIds, ``merged`` the
 *     post-merge rendered bodyIds; both share polygons position-for-position (merge only relabels).
 */
export function expandOverrideAliasesFromBase(
  overrides: ReadonlyMap<string, LensApexOverride> | undefined,
  basePass: () => { sliced: SectionRegion[]; merged: SectionRegion[] },
): ReadonlyMap<string, LensApexOverride> | undefined {
  if (!overrides || overrides.size === 0) return overrides

  const { sliced, merged } = basePass()
  // Map each polygon to its RAW bodyId (from ``sliced``) and its RENDERED bodyId (from ``merged``).
  const rawByPoly = new Map<string, string>()
  for (const r of sliced) if (r.bodyId) rawByPoly.set(`${r.gapIndex}#${polygonKey(r.polygon)}`, r.bodyId)
  // Group raw bodies by their rendered (merged) representative: rendered id → set of raw bodies.
  const rawByRender = new Map<string, Set<string>>()
  for (const r of merged) {
    if (!r.bodyId) continue
    const raw = rawByPoly.get(`${r.gapIndex}#${polygonKey(r.polygon)}`)
    if (!raw) continue
    const set = rawByRender.get(r.bodyId) ?? rawByRender.set(r.bodyId, new Set()).get(r.bodyId)!
    set.add(raw)
    set.add(r.bodyId) // the rendered id is itself a raw body (the merge representative)
  }

  const expanded = new Map<string, LensApexOverride>(overrides)
  for (const [key, ov] of overrides) {
    // Key form is ``bodyId@gapIndex`` (``lensApexOverrideKey``). Split on the LAST '@'.
    const at = key.lastIndexOf('@')
    if (at < 0) continue
    const renderBody = key.slice(0, at)
    const gapIndex = Number(key.slice(at + 1))
    if (!Number.isFinite(gapIndex)) continue
    for (const raw of rawByRender.get(renderBody) ?? []) {
      const alias = lensApexOverrideKey(raw, gapIndex)
      if (!expanded.has(alias)) expanded.set(alias, ov)
    }
  }
  return expanded
}
