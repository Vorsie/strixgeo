// Partition-engine selector — the ONE place the section overlay, the voxel
// build request, and the fence builder pick between the DEFAULT closed-loop
// v2 engine (``partitionFillV2``) and the old v1 fallback (``partitionFill``).
// See ``docs/design/partition-engine-v2.md`` §6: a dev-only toggle selects the
// engine in one place; v1 survives only as the troubleshooting fallback
// (owner 2026-08-27: "dit is niet meer experimenteel maar de main engine").
//
// Scope: DEVICE-local, not project-scoped. The engine choice is a dogfeed / dev
// preference about HOW the same model renders, not an engineering decision
// stored in the model — so it belongs in localStorage, never the .gmproj bundle
// (CLAUDE.md "Project files": the bundle carries engineering decisions,
// localStorage carries per-user UI/dev chrome). This mirrors the ``useTheme``
// localStorage pattern (read/write behind try/catch, silent on quota / privacy
// mode) rather than the project-scoped ``lithoSegmenterPrefs`` view_state
// pattern, because the pref must NOT travel with the file.
//
// Flag resolution, in priority order:
//   1. Env override (tests / node):  ``process.env.STRIX_PARTITION_V2 === '1'``
//      forces v2. Lets a vitest / node harness pin the engine without touching
//      localStorage (which may not exist outside jsdom).
//   2. Device-local pref (localStorage): the Settings toggle. Default v2 — v1 is
//      now the explicit opt-OUT fallback.
//
// v2 became the default on 2026-08-01, measured rather than assumed. Both engines
// were run over the owner's real 14 sections and built through the production voxel
// pipeline with nothing but the engine differing (``scripts/diag_engine_fidelity_ab.py``,
// whose v2 arm reproduces the owner's persisted build exactly). The drilled gate is
// identical at 54 exact / 0 subsequence / 0 wrong; contact-error median is unchanged,
// p90 goes 0.125 → 0.123 m and the WORST contact error 5.335 → 3.145 m; the mesh is
// 1.5 % smaller. Before the flip a fresh install got v1 while the owner dogfed v2, so
// the model anyone else saw was not the model that had been validated.
//
// Change notification: a module-level subscriber set + ``useSyncExternalStore``
// hook so a component that reads the flag (the section overlay) re-renders the
// instant the Settings toggle flips it. Plain (non-React) call sites
// (``buildVoxelRequest`` / ``buildProjectFence``) read the flag at call time via
// ``computeSectionFillActive`` — they run on an explicit "Build" click, so they
// naturally pick up the current value without a subscription.

import { useSyncExternalStore } from 'react'

import { computeSectionFill } from './partitionFill'
import type {
  CorrelationEdge,
  LensApexOverride,
  PartitionColumn,
  SectionRegion,
} from './partitionFill'
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

/** localStorage key for the device-local engine choice. Namespaced like the
 *  theme key (``groundmodel.theme``) so all device chrome shares one prefix. */
const STORAGE_KEY = 'groundmodel.partitionEngineV2'

/** Subscribers notified when the device-local flag flips (Settings toggle).
 *  Feeds ``useSyncExternalStore`` so React re-renders live. */
const subscribers = new Set<() => void>()

/**
 * Read the env override, if present. Guarded for the browser bundle where
 * ``process`` is undefined — Vite does not shim it, so a bare ``process.env``
 * reference would throw ``ReferenceError`` at module load in the renderer.
 *
 * Returns
 * -------
 * boolean | null
 *     ``true`` / ``false`` when ``STRIX_PARTITION_V2`` is explicitly ``'1'`` /
 *     any other value; ``null`` when the variable is absent (defer to the pref).
 */
function readEnvOverride(): boolean | null {
  if (typeof process === 'undefined' || !process.env) return null
  const raw = process.env.STRIX_PARTITION_V2
  if (raw === undefined) return null
  return raw === '1'
}

/**
 * Read the device-local engine pref out of localStorage.
 *
 * Best-effort and inverted from how it used to read: a missing key, a malformed
 * value, or an unavailable localStorage (privacy mode, worker context, node
 * without jsdom) all mean "no opt-out was ever recorded", so they take the
 * DEFAULT engine, which is v2. Only a stored ``'0'`` selects v1. Never throws —
 * a storage failure must not decide which engine renders, and a worker or node
 * context must render the same engine as the app rather than the fallback.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` for v2 (the default, and anything that is not an explicit
 *     opt-out); ``false`` only when the user has opted out on this device.
 */
function readStoredV2(): boolean {
  if (typeof localStorage === 'undefined') return true
  try {
    // Absent key means "never chosen" and must read as the DEFAULT, not as opt-out.
    // Only an explicit '0' selects v1.
    return localStorage.getItem(STORAGE_KEY) !== '0'
  } catch {
    // localStorage unavailable (privacy mode, quota) — take the default engine.
    return true
  }
}

/**
 * Resolve the active engine flag from env override then device pref.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` → use the v2 closed-loop engine; ``false`` → stable v1.
 */
export function isPartitionEngineV2Active(): boolean {
  const env = readEnvOverride()
  if (env !== null) return env
  return readStoredV2()
}

/**
 * Set the device-local engine pref (Settings toggle). Persists to localStorage
 * and notifies subscribers so live consumers re-render. Reversible UI/dev
 * chrome — applied immediately, no Save step (matches the theme toggle).
 *
 * Parameters
 * ----------
 * useV2 : boolean
 *     ``true`` to opt into the v2 engine on this device, ``false`` for v1.
 */
export function setPartitionEngineV2(useV2: boolean): void {
  if (typeof localStorage !== 'undefined') {
    try {
      // Store the opt-OUT explicitly; clearing the key returns to the default, which
      // is now v2. Writing '1' as well keeps the value readable rather than implicit.
      if (useV2) localStorage.setItem(STORAGE_KEY, '1')
      else localStorage.setItem(STORAGE_KEY, '0')
    } catch {
      // Quota / privacy mode — session-level state still updates via notify().
    }
  }
  log.info('partition', `engine pref set → ${useV2 ? 'v2 (default)' : 'v1 (fallback)'}`)
  for (const cb of subscribers) cb()
}

/**
 * Subscribe to device-local flag flips. Returns an unsubscribe function.
 * Consumed by ``useSyncExternalStore``; not called directly.
 *
 * Parameters
 * ----------
 * cb : () => void
 *     Invoked (no args) whenever ``setPartitionEngineV2`` runs.
 *
 * Returns
 * -------
 * () => void
 *     Unsubscribe.
 */
function subscribe(cb: () => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

/**
 * React hook: the current engine flag, re-rendering the component live when the
 * Settings toggle flips it. Use in the overlay so its ``computeSectionFillActive``
 * memo recomputes on flip (include the returned value in the memo dep array).
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when v2 is active.
 */
export function usePartitionEngineV2(): boolean {
  // getSnapshot returns the fully-resolved flag (env override wins) so the hook
  // and the plain selector always agree on a given render.
  return useSyncExternalStore(subscribe, isPartitionEngineV2Active, isPartitionEngineV2Active)
}

// One-time log of the FIRST engine choice a given render path resolves, so a
// dogfeed screenshot's console shows which engine actually drew — without
// spamming a line on every one of the many per-render calls. Reset on flip via
// ``setPartitionEngineV2`` -> the next call re-logs the new choice.
let lastLoggedV2: boolean | null = null

/**
 * Compute the section partition with the ACTIVE engine (v1 or v2), selected by
 * the device-local flag / env override. Drop-in for ``computeSectionFill`` —
 * same signature, same ``SectionRegion[]`` contract — so every production call
 * site (2D overlay, 3D voxel build, fence panels) switches engines in one edit.
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
 *     The partition regions — identical shape from either engine.
 */
export function computeSectionFillActive(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
  alongM?: readonly number[],
): SectionRegion[] {
  const useV2 = isPartitionEngineV2Active()
  if (useV2 !== lastLoggedV2) {
    lastLoggedV2 = useV2
    log.info('partition', `active engine = ${useV2 ? 'v2 (terminations-first sweep)' : 'v1 (old fallback)'}`)
  }
  if (useV2) {
    // App-selected v2 = the FLAG-ON terminations-first engine. The sweep flag
    // (tileFlags) is module state that only tests managed until session 39 —
    // without this the app silently ran the flag-OFF seam engine even with the
    // v2 toggle on (owner dogfeed 2026-07-19: "this doesn't look like any
    // renders"). The compute is synchronous, so set/restore cannot leak across
    // renders.
    const prev = setTwoSidedTerminations(true)
    try {
      return computeSectionFillV2(columns, edges, lensApexOverrides, alongM)
    } finally {
      setTwoSidedTerminations(prev)
    }
  }
  return computeSectionFill(columns, edges, lensApexOverrides, alongM)
}

/**
 * Identity-carrying variant of {@link computeSectionFillActive} (slice 5, "persist
 * geometric body identity"): the partition regions relabelled by the FALLBACK-EXCLUDING
 * body weld, plus that weld's merge groups in LAYER-id space (per connected component,
 * the union of member regions' ``layerIds``; components with fewer than two layers are
 * dropped — see ``partitionFillV2/fillIdentity.ts`` for why layer ids, never body ids,
 * are the wire currency).
 *
 * The v2 engine's ordinary output welds same-litho regions THROUGH substrate/flood
 * fallback paint so the render reads coherently; the identity the backend persists must
 * not — see ``partitionFillV2/fillIdentity.ts``. The v1 engine has no client-side body
 * merge at all, so its identity is its plain output with no groups.
 *
 * Parameters mirror ``computeSectionFillActive``.
 *
 * Returns
 * -------
 * { regions: SectionRegion[]; groups: string[][]; engineV2: boolean }
 *     ``regions`` — the identity-relabelled partition (v2) or the plain v1 output.
 *     ``groups`` — the per-component LAYER ids (``[]`` on v1).
 *     ``engineV2`` — which engine produced them (payload logging).
 */
export function computeSectionFillActiveWithIdentity(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
  alongM?: readonly number[],
): { regions: SectionRegion[]; groups: string[][]; engineV2: boolean } {
  const useV2 = isPartitionEngineV2Active()
  if (!useV2) {
    return { regions: computeSectionFill(columns, edges, lensApexOverrides, alongM), groups: [], engineV2: false }
  }
  // Same flag-ON wiring as computeSectionFillActive — see the comment there.
  const prev = setTwoSidedTerminations(true)
  try {
    const outcome = classifyOverrideOutcome(columns, edges, lensApexOverrides, alongM, {
      withIdentity: true,
    })
    // ``identity`` is present by construction when ``withIdentity`` was passed; the
    // fallback arm keeps the type honest without inventing groups.
    const identity: FillIdentity = outcome.identity ?? { regions: outcome.regions, groups: [] }
    return { regions: identity.regions, groups: identity.groups, engineV2: true }
  } finally {
    setTwoSidedTerminations(prev)
  }
}

/**
 * Diagnostics-carrying variant of {@link computeSectionFillActive}: returns the
 * partition regions AND the v2 crossing-tie conflicts (owner §8 Q4). The plain
 * ``computeSectionFillActive`` stays the regions-only drop-in for the 3D voxel
 * build request builder + the fence builder (they don't render a warning). The 2D
 * section overlay uses THIS so it can surface a persistent, non-blocking warning
 * when approved correlation ties cross (bands suppressed until resolved).
 *
 * The v1 engine has no crossing-conflict model, so its ``conflicts`` is always
 * ``[]`` — the warning surface is a v2-only concern.
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
 * { regions: SectionRegion[]; conflicts: TieConflict[]; overrideStatus: OverrideOutcome['status'] }
 *     The partition regions (identical to ``computeSectionFillActive``), the detected crossing-tie
 *     conflicts (``[]`` on the v1 engine), AND the free-draw override outcome status
 *     (``applied`` | ``rejected-unsafe`` | ``unsupported``). The status is the load-bearing signal
 *     for the owner's "red handle + snap-back" UX: on a live drag, ``rejected-unsafe`` means the
 *     engine refused the reach (it rendered the un-reshaped base fill), so the overlay reddens the
 *     dragged handle and snaps it back on release. The v1 engine has no override-rejection model, so
 *     its status is always ``unsupported`` (persist / no red — today's behaviour).
 */
export function computeSectionFillActiveWithDiagnostics(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
  alongM?: readonly number[],
): { regions: SectionRegion[]; conflicts: TieConflict[]; reviewFlags: ReviewFlag[]; overrideStatus: OverrideOutcome['status'] } {
  const useV2 = isPartitionEngineV2Active()
  if (useV2 !== lastLoggedV2) {
    lastLoggedV2 = useV2
    log.info('partition', `active engine = ${useV2 ? 'v2 (terminations-first sweep)' : 'v1 (old fallback)'}`)
  }
  if (useV2) {
    // Same flag-ON wiring as computeSectionFillActive — see the comment there. Consume
    // ``classifyOverrideOutcome`` DIRECTLY (not ``computeSectionFillV2WithConflicts``, which discards
    // the status) so the override outcome is surfaced with NO extra engine pass — this is the same
    // single call ``computeSectionFillV2WithConflicts`` already delegated to internally.
    const prev = setTwoSidedTerminations(true)
    try {
      const outcome = classifyOverrideOutcome(columns, edges, lensApexOverrides, alongM)
      // ``reviewFlags`` = the uncorrelated same-litho neighbours the safe-default repair re-emitted
      // (drilled units that would otherwise render a foreign litho). The overlay surfaces them so the
      // user can correlate the pair into one band. v1 has no repair model → always ``[]``.
      return { regions: outcome.regions, conflicts: outcome.conflicts, reviewFlags: outcome.reviewFlags, overrideStatus: outcome.status }
    } finally {
      setTwoSidedTerminations(prev)
    }
  }
  return {
    regions: computeSectionFill(columns, edges, lensApexOverrides, alongM),
    conflicts: [],
    reviewFlags: [],
    overrideStatus: 'unsupported',
  }
}
