// Shell-level body-identity recompute wiring (slice 5) — mounted ONCE in App,
// stage-independent (owner ruling 2026-08-12): the assembly inputs
// (investigations + layers + sections + edges) are all loaded by the shell /
// useGeologicalModel regardless of which stage is on screen, so the recompute
// must not depend on the Sections stage being mounted.
//
// Three responsibilities:
//
//   1. PROJECT-OPEN TRIGGER — when a project finishes loading AND a model's data
//      is available (sections projected + layers loaded), schedule ONE background
//      recompute for the LITHO model and ONE for the GEOTECH model (when they
//      exist). Once per model per PROJECT-OPEN: the once-markers are keyed
//      ``projectId|modelId`` and RESET on project switch/close, so reopening
//      fires again. EVENT-DRIVEN by construction: the marker is consumed only
//      when the gate is OPEN and the schedule actually happens — a gate closed
//      at mount leaves the marker unconsumed, and the effect re-fires when the
//      gate opens (the 2026-08-12 defect: the old stage-entry trigger could be
//      consumed before its data-loaded gate opened, so the litho model never
//      recomputed on entry).
//   2. NONCE WATCH — mutation sites bump the per-axis coordinator nonces
//      (``requestBodyRecompute``); this hook translates each bump into a
//      debounced schedule for that axis's model. Nonces bumped while the gate is
//      closed are NOT consumed — they fire when the gate opens.
//   3. The debounced scheduler itself (``useBodyRecompute``) + the module-ref
//      bridge to the toolbar's manual "Recompute bodies" verb.

import { useCallback, useEffect, useMemo, useRef } from 'react'

import { assembleBodyRecomputePayload } from '../shell/stages/shared/makeBodyRecomputeBuilder'
import type {
  InvestigationLocation,
  LithoLayerLike,
  SectionLike,
} from '../utils/assembleLithoSectionInputs'
import { useBodyRecompute, type UseBodyRecomputeResult } from './useBodyRecompute'

/**
 * Module-ref bridge to the toolbar's manual "Recompute bodies" verb — the same
 * pattern as ``lithoVoxelRequestCallback``: the shell hook assigns
 * ``recomputeNow`` every render; ``SectionsToolbar`` (which has no access to
 * the scheduler) invokes it with the active axis's model id.
 */
export const sectionsBodyRecomputeCallback: {
  current: ((modelId: string) => Promise<void>) | null
} = {
  current: null,
}

/** Everything the shell-level recompute wiring reads. */
export interface UseProjectBodyRecomputeArgs {
  /** The open project's id, or null when no project is open. */
  projectId: string | null
  /** Manifest-gated sections (the same set every consumer projects onto). */
  visibleSections: readonly SectionLike[]
  /** Manifest-gated CPTs (projection shape — extra fields are fine). */
  visibleCpts: readonly InvestigationLocation[]
  /** Manifest-gated boreholes (projection shape). */
  visibleBoreholes: readonly InvestigationLocation[]
  /** The active litho model id, or null when the project has none. */
  lithoModelId: string | null
  /** The litho model's layer rows. */
  lithoLayers: readonly LithoLayerLike[]
  /** The active geotech packing model id, or null. */
  geotechModelId: string | null
  /** The geotech model's band rows. */
  geotechLayers: readonly LithoLayerLike[]
  /**
   * Disambiguates ``geotechLayers === []``: the bus clears the array before
   * every refetch and on a failed load, so emptiness alone cannot be read as
   * "nothing is committed".
   */
  geotechLayersLoaded: boolean
  /** Coordinator nonce — bumped by every litho-model mutation site. */
  bodyRecomputeLithoNonce: number
  /** Coordinator nonce — bumped by every geotech-model mutation site. */
  bodyRecomputeGeotechNonce: number
  /** The app toast fn (threaded to the scheduler). */
  toast: (kind: 'success' | 'error', message: string) => void
}

/**
 * Mount the shell-level body-identity recompute wiring (project-open trigger +
 * nonce watch + debounced scheduler + toolbar bridge).
 *
 * Parameters
 * ----------
 * args : UseProjectBodyRecomputeArgs
 *     Live shell values; fire-time reads go through the scheduler's own ref.
 *
 * Returns
 * -------
 * UseBodyRecomputeResult
 *     ``scheduleRecompute`` + ``recomputeNow`` (also exposed to the toolbar via
 *     ``sectionsBodyRecomputeCallback``).
 */
export function useProjectBodyRecompute(
  args: UseProjectBodyRecomputeArgs,
): UseBodyRecomputeResult {
  const {
    projectId,
    visibleSections,
    visibleCpts,
    visibleBoreholes,
    lithoModelId,
    lithoLayers,
    geotechModelId,
    geotechLayers,
    geotechLayersLoaded,
    bodyRecomputeLithoNonce,
    bodyRecomputeGeotechNonce,
    toast,
  } = args

  const investigations = useMemo<InvestigationLocation[]>(
    () => [
      ...visibleCpts.map(c => ({
        id: c.id,
        location_x: c.location_x,
        location_y: c.location_y,
        elevation_m: c.elevation_m,
      })),
      ...visibleBoreholes.map(b => ({
        id: b.id,
        location_x: b.location_x,
        location_y: b.location_y,
        elevation_m: b.elevation_m,
      })),
    ],
    [visibleCpts, visibleBoreholes],
  )

  const buildPayload = useCallback(
    (modelId: string) => {
      // Which layer snapshot feeds the payload follows the MODEL, not the
      // rendered stage/axis — a litho mutation must recompute litho even while
      // the user looks at another stage.
      const isGeotechTarget = modelId === geotechModelId
      return assembleBodyRecomputePayload({
        projectId,
        modelId,
        visibleSections,
        investigations,
        layers: isGeotechTarget ? geotechLayers : lithoLayers,
        logLabel: isGeotechTarget ? 'geotech-recompute' : 'litho-recompute',
      })
    },
    [projectId, geotechModelId, visibleSections, investigations, geotechLayers, lithoLayers],
  )

  const { scheduleRecompute, recomputeNow } = useBodyRecompute({
    projectId,
    buildPayload,
    dataLoaded: visibleSections.length > 0,
    toast,
  })

  // Module-ref bridge for the toolbar's manual verb. Assigned every render so
  // the ref is always current while the shell is mounted.
  sectionsBodyRecomputeCallback.current = recomputeNow

  // ---- 1. PROJECT-OPEN once-markers, reset on switch/close. -----------------
  // Declared BEFORE the trigger effects so the reset runs first on the commit
  // where the project id changes (effects run in declaration order).
  const firedThisOpenRef = useRef(new Set<string>())
  useEffect(() => {
    firedThisOpenRef.current.clear()
  }, [projectId])

  // LITHO project-open trigger. The marker is consumed ONLY on an actual
  // schedule (gate open) — a closed gate leaves it for the render where the
  // gate opens. A litho model with zero accepted layers has nothing to
  // recompute; if layers land later, this fires then.
  useEffect(() => {
    if (projectId === null || lithoModelId === null) return
    if (visibleSections.length === 0 || lithoLayers.length === 0) return
    const key = `${projectId}|${lithoModelId}`
    if (firedThisOpenRef.current.has(key)) return
    firedThisOpenRef.current.add(key)
    scheduleRecompute(lithoModelId)
  }, [projectId, lithoModelId, visibleSections.length, lithoLayers.length, scheduleRecompute])

  // GEOTECH project-open trigger — same rule, gated on the loaded FLAG too
  // (an empty geotechLayers array is ambiguous without it).
  useEffect(() => {
    if (projectId === null || geotechModelId === null) return
    if (visibleSections.length === 0 || !geotechLayersLoaded || geotechLayers.length === 0) return
    const key = `${projectId}|${geotechModelId}`
    if (firedThisOpenRef.current.has(key)) return
    firedThisOpenRef.current.add(key)
    scheduleRecompute(geotechModelId)
  }, [projectId, geotechModelId, visibleSections.length, geotechLayersLoaded, geotechLayers.length, scheduleRecompute])

  // ---- 2. NONCE WATCH — one debounced schedule per bump, gate-respecting. ----
  // The last PROCESSED nonce lives in a ref seeded with the mount-time value, so
  // mounting never reads a pre-existing nonce as a fresh mutation. A bump that
  // arrives while the gate is closed is NOT consumed — the effect re-runs when
  // the gate opens and fires then (same event-driven rule as the open trigger).
  const lastLithoNonceRef = useRef(bodyRecomputeLithoNonce)
  useEffect(() => {
    if (bodyRecomputeLithoNonce === lastLithoNonceRef.current) return
    if (lithoModelId === null || visibleSections.length === 0 || lithoLayers.length === 0) return
    lastLithoNonceRef.current = bodyRecomputeLithoNonce
    scheduleRecompute(lithoModelId)
  }, [bodyRecomputeLithoNonce, lithoModelId, visibleSections.length, lithoLayers.length, scheduleRecompute])

  const lastGeotechNonceRef = useRef(bodyRecomputeGeotechNonce)
  useEffect(() => {
    if (bodyRecomputeGeotechNonce === lastGeotechNonceRef.current) return
    if (
      geotechModelId === null ||
      visibleSections.length === 0 ||
      !geotechLayersLoaded ||
      geotechLayers.length === 0
    )
      return
    lastGeotechNonceRef.current = bodyRecomputeGeotechNonce
    scheduleRecompute(geotechModelId)
  }, [bodyRecomputeGeotechNonce, geotechModelId, visibleSections.length, geotechLayersLoaded, geotechLayers.length, scheduleRecompute])

  return { scheduleRecompute, recomputeNow }
}
