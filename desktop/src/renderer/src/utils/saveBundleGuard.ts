// Pre-write data-loss guard for the ``.strix`` save path (debt #225).
//
// ``useProject.saveProject`` does a fresh ``GET /bundle`` and then writes that
// bundle to the ``.strix`` file. If the bundle comes back with a
// normally-populated collection empty — the observed shape was
// ``litho_contact_correlation_edges: []`` while the database held 481 rows,
// a TRANSIENT bad state of the export query — the save would silently
// overwrite the user's file with empty data. That is a data-loss shape: the
// file is the user's anchor, and the next open would bring back nothing.
//
// This module is the pure ASSESSOR half of the guard: given the row counts of
// the FRESHLY FETCHED bundle and the counts the app KNOWS it holds (the last
// opened / saved file's counts for the interpretation collections, the live
// session manifest for the imported ones), it reports every collection that
// came back empty while the app expected rows.
//
// The orchestration lives in ``useProject`` (``guardEmptyBundle``) and stops
// the SILENT overwrite, not every overwrite — the owner clears collections on
// purpose all the time, so a hard block would loop forever. On a finding it
// re-fetches the bundle ONCE: if the retry heals (the transient bad export
// state passed) it writes the healed bundle; if the retry STILL reads empty it
// ASKS through a confirmation dialog before overwriting the last save. This
// module knows none of that — it only answers "which guarded collections came
// back empty while the app expected rows", the input both the retry check and
// the confirmation body are built from.
//
// Pure by design (no I/O, no logging, no React) so the ruling can be pinned
// directly in unit tests — see ``saveBundleGuard.test.ts``.

/**
 * The bundle collections the guard watches for the "came back empty" shape.
 *
 * Two kinds live here. The interpretation collections
 * (``litho_contact_correlation_edges``, ``litho_layers``,
 * ``formation_contacts``, ``bodies``) ride into the file straight from the
 * bundle and have no session-manifest home, so their "expected" count comes
 * from the last opened / saved file. The imported collections (``cpts``,
 * ``boreholes``, ``geological_formations``, ``cross_sections``) are trimmed to
 * the live manifest on save, so the manifest size is their expected count.
 */
export type GuardedCollection =
  | 'litho_contact_correlation_edges'
  | 'litho_layers'
  | 'formation_contacts'
  | 'bodies'
  | 'cpts'
  | 'boreholes'
  | 'geological_formations'
  | 'cross_sections'

/** Every guarded collection, in a stable order for logs. */
export const GUARDED_COLLECTIONS: readonly GuardedCollection[] = [
  'litho_contact_correlation_edges',
  'litho_layers',
  'formation_contacts',
  'bodies',
  'cpts',
  'boreholes',
  'geological_formations',
  'cross_sections',
] as const

/** Row count per guarded collection. */
export type BundleCollectionCounts = Record<GuardedCollection, number>

/**
 * One collection that came back empty while the app expected rows.
 *
 * Attributes
 * ----------
 * collection : GuardedCollection
 *     Which collection is suspiciously empty.
 * expected : int
 *     How many rows the app knows it holds (from the last file / the manifest).
 * fetched : int
 *     How many the fresh bundle returned — always ``0`` for a finding.
 */
export interface EmptyCollectionFinding {
  collection: GuardedCollection
  expected: number
  fetched: number
}

/**
 * A bundle- or file-shaped object whose guarded collections can be counted.
 *
 * Both ``ProjectBundleResponse`` (the wire shape) and ``ProjectFile`` (the
 * parsed ``.strix``) satisfy this, which is why one counter serves both.
 */
interface CountableBundle {
  litho_contact_correlation_edges?: Record<string, unknown>[]
  bodies?: Record<string, unknown>[]
  cpts?: Record<string, unknown>[]
  boreholes?: Record<string, unknown>[]
  geological_formations?: Record<string, unknown>[]
  cross_sections?: Record<string, unknown>[]
  geological_models?: ReadonlyArray<Record<string, unknown>>
}

/** Length of an array-or-missing field, never throwing. */
function len(rows: unknown): number {
  return Array.isArray(rows) ? rows.length : 0
}

/**
 * Count the guarded collections of a bundle or a parsed project file.
 *
 * ``litho_layers`` and ``formation_contacts`` are summed across every
 * ``geological_models`` entry: a litho model carries its layers there and a
 * geological model carries its formation contacts there, so the flat totals
 * are what the guard compares.
 *
 * Parameters
 * ----------
 * bundle : CountableBundle
 *     A ``GET /bundle`` response or a parsed ``.strix`` — the guarded fields
 *     have the same names on both.
 *
 * Returns
 * -------
 * BundleCollectionCounts
 *     Row count per guarded collection.
 */
export function countBundleCollections(bundle: CountableBundle): BundleCollectionCounts {
  let lithoLayers = 0
  let formationContacts = 0
  for (const model of bundle.geological_models ?? []) {
    lithoLayers += len(model.litho_layers)
    formationContacts += len(model.contacts)
  }
  return {
    litho_contact_correlation_edges: len(bundle.litho_contact_correlation_edges),
    litho_layers: lithoLayers,
    formation_contacts: formationContacts,
    bodies: len(bundle.bodies),
    cpts: len(bundle.cpts),
    boreholes: len(bundle.boreholes),
    geological_formations: len(bundle.geological_formations),
    cross_sections: len(bundle.cross_sections),
  }
}

/**
 * Report every guarded collection that came back empty while the app expected
 * rows — the data-loss shape a save must not silently write.
 *
 * A finding is raised for collection ``k`` exactly when the app knows it holds
 * rows (``expected[k]`` is defined and > 0) yet the fresh bundle returned none
 * (``fetched[k] === 0``). An ``expected`` entry left ``undefined`` means the
 * app has no reliable count for that collection (e.g. the interpretation
 * collections before the first open) and it is NOT guarded — the guard never
 * questions a save on a count it cannot trust, because a false prompt on a save
 * the app cannot even reason about is worse than the transient bug. Findings
 * drive the retry-then-ask orchestration in ``useProject``; a finding is not by
 * itself a refusal.
 *
 * A genuinely empty project (``expected`` all ``0``) raises nothing, so it
 * still saves; a bundle whose counts match (every ``fetched`` > 0) raises
 * nothing and writes as before.
 *
 * Parameters
 * ----------
 * fetched : BundleCollectionCounts
 *     Counts of the freshly fetched bundle.
 * expected : Partial<BundleCollectionCounts>
 *     Counts the app knows it holds. Missing keys are treated as "unknown".
 *
 * Returns
 * -------
 * EmptyCollectionFinding[]
 *     Empty when the save is safe; otherwise one entry per suspicious
 *     collection, in ``GUARDED_COLLECTIONS`` order.
 */
export function assessEmptyBundleGuard(
  fetched: BundleCollectionCounts,
  expected: Partial<BundleCollectionCounts>,
): EmptyCollectionFinding[] {
  const findings: EmptyCollectionFinding[] = []
  for (const collection of GUARDED_COLLECTIONS) {
    const expectedCount = expected[collection]
    if (expectedCount !== undefined && expectedCount > 0 && fetched[collection] === 0) {
      findings.push({ collection, expected: expectedCount, fetched: fetched[collection] })
    }
  }
  return findings
}

/**
 * Render the findings as a compact ``name expected N got 0`` list for the
 * WARNING log. Kept out of the toast, which stays in the debt entry's fixed
 * wording; this line is the dev-facing detail (which collections, how many).
 *
 * Parameters
 * ----------
 * findings : EmptyCollectionFinding[]
 *     The non-empty output of ``assessEmptyBundleGuard``.
 *
 * Returns
 * -------
 * string
 *     e.g. ``"litho_contact_correlation_edges expected 481 got 0"``.
 */
export function describeEmptyBundleFindings(findings: EmptyCollectionFinding[]): string {
  return findings
    .map(f => `${f.collection} expected ${f.expected} got ${f.fetched}`)
    .join(', ')
}
