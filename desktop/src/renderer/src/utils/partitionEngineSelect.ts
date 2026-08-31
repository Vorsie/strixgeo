// Partition-engine entry points — the ONE place the section overlay, the voxel
// build request, and the fence builder obtain the section partition.
//
// There is no engine CHOICE any more. v2 (``partitionFillV2``) became the
// measured default on 2026-08-01 (drilled gate identical at 54 exact / 0
// subsequence / 0 wrong; p90 contact error 0.125 → 0.123 m; worst 5.335 →
// 3.145 m; mesh 1.5 % smaller), the owner declared it the main engine on
// 2026-08-27 ("dit is niet meer experimenteel maar de main engine"), and on
// 2026-08-31 he archived v1 outright ("archive the first faulty engine. the
// new one is de standard") — see docs/debt.md #280. The selector flag, the
// Settings toggle, the ``STRIX_PARTITION_V2`` env override and the v1 fallback
// arms were removed with that ruling; these entry points now simply wrap the
// v2 engine with its sweep-flag wiring.
//
// The three entry points survive by name and signature so their many call
// sites (2D overlay, 3D voxel build, fence panels, body recompute) did not
// churn:
//
//   * ``computeSectionFillActive``            — regions only.
//   * ``computeSectionFillActiveWithIdentity``— + the body weld's merge groups
//     in LAYER-id space (fallback-excluding; see ``partitionFillV2/fillIdentity.ts``).
//   * ``computeSectionFillActiveWithDiagnostics`` — + crossing-tie conflicts,
//     review flags and the free-draw override status.

import type {
  CorrelationEdge,
  LensApexOverride,
  PartitionColumn,
  SectionRegion,
} from './sectionPartition'
import {
  classifyOverrideOutcome,
  computeSectionFillV2,
  type FillIdentity,
  type OverrideOutcome,
  type ReviewFlag,
  type TieConflict,
} from './partitionFillV2'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import { log } from './log'

// One-time log so a dogfeed screenshot's console still names the engine that
// drew — without spamming a line on every one of the many per-render calls.
let loggedEngine = false

/** Log the engine once per session, on the first compute. */
function logEngineOnce(): void {
  if (loggedEngine) return
  loggedEngine = true
  log.info('partition', 'active engine = v2 (terminations-first sweep)')
}

/**
 * Run ``fn`` with the two-sided-terminations sweep flag ON.
 *
 * The sweep flag (``tileFlags``) is module state that only tests managed until
 * session 39 — without this the app silently ran the flag-OFF seam engine
 * (owner dogfeed 2026-07-19: "this doesn't look like any renders"). The compute
 * is synchronous, so set/restore cannot leak across renders.
 *
 * @param fn The compute to run under the flag.
 * @returns Whatever ``fn`` returns.
 */
function withSweepFlag<T>(fn: () => T): T {
  const prev = setTwoSidedTerminations(true)
  try {
    return fn()
  } finally {
    setTwoSidedTerminations(prev)
  }
}

/**
 * Compute the section partition. Drop-in successor of the engine-selecting
 * variant — same signature, same ``SectionRegion[]`` contract — kept as the
 * single seam every production call site (2D overlay, 3D voxel build, fence
 * panels) goes through.
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     Per-investigation column stacks (litho units), left-to-right.
 * edges : readonly CorrelationEdge[], optional
 *     Approved correlation edges (layer-id pairs). Default ``[]``.
 * lensApexOverrides : ReadonlyMap<string, LensApexOverride>, optional
 *     Per-lens apex drag overrides.
 * alongM : readonly number[], optional
 *     True along-section metres per column (1:1 with ``columns``). Lets the
 *     deep-to-deep substrate slice at real spacing instead of the uniform
 *     fallback.
 *
 * Returns
 * -------
 * SectionRegion[]
 *     The partition regions.
 */
export function computeSectionFillActive(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
  alongM?: readonly number[],
): SectionRegion[] {
  logEngineOnce()
  return withSweepFlag(() => computeSectionFillV2(columns, edges, lensApexOverrides, alongM))
}

/**
 * Identity-carrying variant of {@link computeSectionFillActive} (slice 5, "persist
 * geometric body identity"): the partition regions relabelled by the FALLBACK-EXCLUDING
 * body weld, plus that weld's merge groups in LAYER-id space (per connected component,
 * the union of member regions' ``layerIds``; components with fewer than two layers are
 * dropped — see ``partitionFillV2/fillIdentity.ts`` for why layer ids, never body ids,
 * are the wire currency).
 *
 * The engine's ordinary output welds same-litho regions THROUGH substrate/flood
 * fallback paint so the render reads coherently; the identity the backend persists must
 * not — see ``partitionFillV2/fillIdentity.ts``.
 *
 * Parameters mirror ``computeSectionFillActive``.
 *
 * Returns
 * -------
 * { regions: SectionRegion[]; groups: string[][] }
 *     ``regions`` — the identity-relabelled partition.
 *     ``groups`` — the per-component LAYER ids.
 */
export function computeSectionFillActiveWithIdentity(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
  alongM?: readonly number[],
): { regions: SectionRegion[]; groups: string[][] } {
  logEngineOnce()
  return withSweepFlag(() => {
    const outcome = classifyOverrideOutcome(columns, edges, lensApexOverrides, alongM, {
      withIdentity: true,
    })
    // ``identity`` is present by construction when ``withIdentity`` was passed; the
    // fallback arm keeps the type honest without inventing groups.
    const identity: FillIdentity = outcome.identity ?? { regions: outcome.regions, groups: [] }
    return { regions: identity.regions, groups: identity.groups }
  })
}

/**
 * Diagnostics-carrying variant of {@link computeSectionFillActive}: returns the
 * partition regions AND the crossing-tie conflicts (owner §8 Q4). The plain
 * ``computeSectionFillActive`` stays the regions-only drop-in for the 3D voxel
 * build request builder + the fence builder (they don't render a warning). The 2D
 * section overlay uses THIS so it can surface a persistent, non-blocking warning
 * when approved correlation ties cross (bands suppressed until resolved).
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     Per-investigation column stacks (litho units), left-to-right.
 * edges : readonly CorrelationEdge[], optional
 *     Approved correlation edges. Default ``[]``.
 * lensApexOverrides : ReadonlyMap<string, LensApexOverride>, optional
 *     Per-lens apex drag overrides.
 * alongM : readonly number[], optional
 *     True along-section metres per column (1:1 with ``columns``).
 *
 * Returns
 * -------
 * { regions: SectionRegion[]; conflicts: TieConflict[]; reviewFlags: ReviewFlag[]; overrideStatus: OverrideOutcome['status'] }
 *     The partition regions (identical to ``computeSectionFillActive``), the detected
 *     crossing-tie conflicts, the uncorrelated same-litho neighbours the safe-default
 *     repair re-emitted (``reviewFlags`` — the overlay surfaces them so the user can
 *     correlate the pair into one band), AND the free-draw override outcome status
 *     (``applied`` | ``rejected-unsafe`` | ``unsupported``). The status is the
 *     load-bearing signal for the owner's "red handle + snap-back" UX: on a live drag,
 *     ``rejected-unsafe`` means the engine refused the reach (it rendered the
 *     un-reshaped base fill), so the overlay reddens the dragged handle and snaps it
 *     back on release.
 */
export function computeSectionFillActiveWithDiagnostics(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
  alongM?: readonly number[],
): { regions: SectionRegion[]; conflicts: TieConflict[]; reviewFlags: ReviewFlag[]; overrideStatus: OverrideOutcome['status'] } {
  logEngineOnce()
  // Consume ``classifyOverrideOutcome`` DIRECTLY (not
  // ``computeSectionFillV2WithConflicts``, which discards the status) so the
  // override outcome is surfaced with NO extra engine pass — this is the same
  // single call ``computeSectionFillV2WithConflicts`` already delegated to
  // internally.
  return withSweepFlag(() => {
    const outcome = classifyOverrideOutcome(columns, edges, lensApexOverrides, alongM)
    return {
      regions: outcome.regions,
      conflicts: outcome.conflicts,
      reviewFlags: outcome.reviewFlags,
      overrideStatus: outcome.status,
    }
  })
}
