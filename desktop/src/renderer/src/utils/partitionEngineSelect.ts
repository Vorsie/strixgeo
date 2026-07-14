// Partition-engine selector — the ONE place the section overlay, the voxel
// build request, and the fence builder pick between the stable v1 partition
// engine (``partitionFill``) and the experimental closed-loop v2 engine
// (``partitionFillV2``). See ``docs/design/partition-engine-v2.md`` §6: a
// dev-only toggle selects the engine in one place; the old engine remains the
// beta fallback.
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
//   2. Device-local pref (localStorage): the Settings toggle. Default v1 — v2 is
//      strictly opt-in.
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
import { computeSectionFillV2 } from './partitionFillV2'
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
 * Best-effort: a missing key, a malformed value, or an unavailable
 * localStorage (privacy mode, worker context, node without jsdom) all fall
 * back to ``false`` (v1). Never throws — the caller degrades to the stable
 * engine rather than breaking the render / build.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when the user has opted into v2 on this device, else ``false``.
 */
function readStoredV2(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    // localStorage unavailable (privacy mode, quota) — default to stable v1.
    return false
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
      if (useV2) localStorage.setItem(STORAGE_KEY, '1')
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Quota / privacy mode — session-level state still updates via notify().
    }
  }
  log.info('partition', `engine pref set → ${useV2 ? 'v2 (experimental)' : 'v1 (stable)'}`)
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
    log.info('partition', `active engine = ${useV2 ? 'v2 (experimental)' : 'v1 (stable)'}`)
  }
  return useV2
    ? computeSectionFillV2(columns, edges, lensApexOverrides, alongM)
    : computeSectionFill(columns, edges, lensApexOverrides, alongM)
}
