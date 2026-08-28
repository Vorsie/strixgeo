/**
 * Resolve WHICH cross-section a lab sample's borehole should be revealed on,
 * and what to say when it is on none.
 *
 * Owner ask 2026-08-28, verbatim: *"is there a way we can right click a psd
 * curve and go to the sample in question on a cross section?"* — a right-click
 * on a PSD curve navigates to that sample's borehole on the Sections stage.
 *
 * Two decisions this ask says must not be guessed live here, both pure:
 *
 *   * **Which section** — the canonical section-membership rule
 *     (``memberIdsBySection`` → in corridor AND between the endpoints,
 *     exclusions honoured; already the pooling population). This module never
 *     re-derives membership: it reads the map the caller already computed with
 *     that rule, and when several sections carry the borehole it picks the
 *     FIRST in the map's order (the order the Sections stage lists them), so
 *     the answer is deterministic rather than "whichever the Set happened to
 *     iterate first".
 *   * **On no section** — an honest sentence, mirroring the pending-tie chip's
 *     "why you cannot see it": name the sample and say what to do, rather than
 *     failing silently.
 *
 * The navigation itself reuses the existing deep-link machinery
 * (``setSectionsDeepLinkTarget`` → ``AppShell`` → the section-column reveal
 * that the Build pre-flight already drives); this module only decides the
 * target and the fallback words.
 *
 * @module shell/stages/parameters/sampleSectionReveal
 */

/** The sample fields the honest "on no section" line needs to name it. */
export interface SampleIdentity {
  /** The hole the sample came from. */
  boreholeName: string
  /** Sample number when the lab recorded one, else ``null``. */
  sampleNumber: string | null
  /** Sample interval top, metres below the collar. */
  depthTopM: number
  /** Sample interval base, metres below the collar. */
  depthBaseM: number
}

/**
 * The cross-section to open for an investigation, or ``null`` when it is on
 * none.
 *
 * Reads the caller's canonical per-section member map (``memberIdsBySection``)
 * — never a second membership derivation, so it cannot drift from what the
 * section view actually draws. When several sections contain the investigation
 * the FIRST in the map's iteration order wins: that order is the sections'
 * own list order, so the choice is stable across renders.
 *
 * Parameters
 * ----------
 * bySection : ReadonlyMap<string, ReadonlySet<string>>
 *     Per-section member investigation ids, in the sections' list order.
 * investigationId : string
 *     The borehole (or CPT) whose section is wanted.
 *
 * Returns
 * -------
 * string | null
 *     The chosen section id, or ``null`` when no section carries it.
 */
export function pickSectionForInvestigation(
  bySection: ReadonlyMap<string, ReadonlySet<string>>,
  investigationId: string,
): string | null {
  for (const [sectionId, members] of bySection) {
    if (members.has(investigationId)) return sectionId
  }
  return null
}

/** ``sample 3`` when numbered, else a bare "the sample" — for the sentence. */
function sampleClause(sampleNumber: string | null): string {
  return sampleNumber !== null ? `sample ${sampleNumber}` : 'this sample'
}

/**
 * The honest line shown when a sample's borehole is on no cross-section.
 *
 * Names the sample (borehole + number + depth) so the engineer recognises it,
 * then says what to do — draw or widen a section that reaches the hole — rather
 * than ending on a diagnosis, the same shape the pending-tie chip uses.
 *
 * Parameters
 * ----------
 * sample : SampleIdentity
 *     The sample the right-click was on.
 *
 * Returns
 * -------
 * string
 *     One sentence, English, safe to hand straight to ``toast``.
 */
export function sampleNotOnAnySectionMessage(sample: SampleIdentity): string {
  const depth = `${sample.depthTopM.toFixed(2)}–${sample.depthBaseM.toFixed(2)} m`
  return (
    `${sampleClause(sample.sampleNumber)} in ${sample.boreholeName} ` +
    `(${depth}) is on no cross-section — its borehole projects onto none of ` +
    `this project's section lines. Draw a section through ${sample.boreholeName}, ` +
    `or widen a section's corridor to reach it.`
  )
}
