// Pre-build enclosed-lens body merge — the caller debt #243 was missing.
//
// A lithology split on one column only by a LOCAL lens should read as ONE body
// (owner directive 2026-06-05: "the big sand is one body"). The backend use case
// that does this has existed, unit-tested and correct, since then — but nothing
// ever invoked it, so on every model each enclosed-lens host is still two
// bodies. Owner decision 2026-07-27: fire it on BUILD, with a report.
//
// Section-scoped: the planner uses the active section's column adjacency, so a
// model-wide merge is one call per visible section.
//
// SEQUENTIAL, not parallel — this is a correctness rule, not a style choice.
// Each merge POST creates edges, re-runs ResolveLithoInstances model-wide, and
// commits. Two of those in flight at once would race on the same body_id
// re-stamp. fetchApprovedEdgesBySection (its read-only sibling) fans out with
// Promise.all precisely because it writes nothing.
//
// A failed section degrades to "no merge on that section" rather than aborting
// the build: the model still builds, just without that section's merges. The
// failed ids are returned so the caller can name them in the log.

import { api } from '../../../api/client'

/** What one pre-build merge pass did, for the toast + the log line. */
export interface EnclosedLensMergeReport {
  /** Net-new correlation edges created across all sections. */
  edgesCreated: number
  /** Planned edges that already existed (idempotent re-run). */
  edgesSkippedExisting: number
  /** Sections where at least one net-new edge was created. */
  sectionsMerged: number
  /** Sections the pass tried (i.e. the visible-section count). */
  sectionsAttempted: number
  /** Sections whose merge call rejected — skipped, not fatal. */
  failedSectionIds: string[]
}

/**
 * Merge enclosed-lens-split bodies across every visible section, in order.
 *
 * Runs ``POST .../bodies/merge-enclosed-lenses`` once per section, one at a
 * time. The caller MUST reload the litho layers afterwards before recomputing
 * the partition — the merge re-stamps ``body_id`` in the DB while the voxel
 * build takes body identity from the frontend payload (docs/debt.md #243).
 *
 * Parameters
 * ----------
 * projectId : string
 *     The app project id.
 * modelId : string
 *     The lithostratigraphic model whose bodies are merged.
 * sections : readonly { id: string }[]
 *     The visible sections; each defines its own column adjacency.
 *
 * Returns
 * -------
 * Promise<EnclosedLensMergeReport>
 *     Aggregate counts. Never rejects — a per-section failure is reported in
 *     ``failedSectionIds``.
 */
export async function mergeEnclosedLensesForBuild(
  projectId: string,
  modelId: string,
  sections: readonly { id: string }[],
): Promise<EnclosedLensMergeReport> {
  let edgesCreated = 0
  let edgesSkippedExisting = 0
  let sectionsMerged = 0
  const failedSectionIds: string[] = []

  for (const section of sections) {
    try {
      const result = await api.geology.mergeEnclosedLenses(projectId, modelId, section.id)
      edgesCreated += result.edges_created
      edgesSkippedExisting += result.edges_skipped_existing
      if (result.edges_created > 0) sectionsMerged += 1
    } catch {
      failedSectionIds.push(section.id)
    }
  }

  return {
    edgesCreated,
    edgesSkippedExisting,
    sectionsMerged,
    sectionsAttempted: sections.length,
    failedSectionIds,
  }
}

/**
 * Turn a merge report into the user-facing toast, or ``null`` for silence.
 *
 * Silent when the pass changed nothing and nothing failed — that is the normal
 * state of every build after the first, and a "merged 0" toast on every Build
 * would be pure noise.
 *
 * The count is in CORRELATIONS, not lenses: one enclosed lens yields two edges
 * (both bracketing host halves), and the backend reports edges only — so
 * phrasing this as "N lenses" would overstate it by roughly 2×.
 *
 * Parameters
 * ----------
 * report : EnclosedLensMergeReport
 *     Aggregate outcome of the pass.
 *
 * Returns
 * -------
 * { type: 'success' | 'warning'; message: string } | null
 *     The toast to raise, or null when there is nothing worth saying.
 */
export function describeEnclosedLensMerge(
  report: EnclosedLensMergeReport,
): { type: 'success' | 'warning'; message: string } | null {
  const failed = report.failedSectionIds.length
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

  if (report.edgesCreated === 0) {
    if (failed === 0) return null
    return {
      type: 'warning',
      message: `Enclosed-lens merge failed on ${plural(failed, 'section')} — those bodies stay split.`,
    }
  }

  const base =
    `Merged enclosed-lens bodies: ${plural(report.edgesCreated, 'new correlation')} ` +
    `across ${plural(report.sectionsMerged, 'section')}`
  return failed === 0
    ? { type: 'success', message: `${base}.` }
    : { type: 'warning', message: `${base}; ${plural(failed, 'section')} failed.` }
}
