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
//      bridge to the "4 · Divide boreholes" verb (the "Recompute bodies" bridge
//      was removed with that verb — owner ruling 6, 2026-09-12).

import { useCallback, useEffect, useMemo, useRef } from 'react'

import { assembleBodyRecomputePayload } from '../shell/stages/shared/makeBodyRecomputeBuilder'
import { assembleDividePartition } from '../shell/stages/shared/makeDividePartitionBuilder'
import type {
  InvestigationLocation,
  LithoLayerLike,
  SectionLike,
} from '../utils/assembleLithoSectionInputs'
import { useBodyRecompute, type UseBodyRecomputeResult } from './useBodyRecompute'
import {
  packingClassOfFormations,
  type PackingClassSource,
} from '../utils/geotechHierarchicalFill/packingClassOf'

/**
 * Module-ref bridge to the toolbar's "4 · Divide boreholes" verb.
 *
 * (The sibling bridge to the manual "Recompute bodies" verb was removed with
 * that verb — owner ruling 6, 2026-09-12. The recompute is fully automatic now;
 * nothing outside this hook calls it, so the bridge would be dead code.)
 *
 * The divide reads each borehole column off the 2-D geometry it stands in
 * (owner ruling 2026-08-15), and this hook is where the inputs that geometry is
 * assembled from already live: the visible sections, every investigation's
 * position, and the geotech bands. The toolbar has none of them, so it calls
 * this and hands the result to the divide.
 *
 * Returns ``null`` when the geometry cannot be assembled, which the divide
 * sends as an omitted field — the backend then answers with the donor rule,
 * exactly as it did before the geometry existed.
 */
export const sectionsDividePartitionCallback: {
  current: ((sectionId: string) => Promise<Record<string, unknown> | null>) | null
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
  /**
   * The geotech model's formation rows — the source of the packing-class
   * identity map (owner 2026-08-21: one mass one body; the model keeps one
   * formation row per (class, litho parent, geological parent), so identity
   * evidence must compare the CLASS, never the row).
   */
  geotechFormations: readonly PackingClassSource[]
  /** Coordinator nonce — bumped by every litho-model mutation site. */
  bodyRecomputeLithoNonce: number
  /** Coordinator nonce — bumped by every geotech-model mutation site. */
  bodyRecomputeGeotechNonce: number
  /** The app toast fn (threaded to the scheduler). Includes ``warning`` + an
   *  optional replace key so the scheduler can surface a failed recompute once. */
  toast: (kind: 'success' | 'error' | 'warning', message: string, replaceKey?: string) => void
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
 *     ``scheduleRecompute`` — the automatic mutation-path entry point.
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
    geotechFormations,
    bodyRecomputeLithoNonce,
    bodyRecomputeGeotechNonce,
    toast,
  } = args

  // Formation row → canonical class key — the identity the geotech evidence
  // groups by (litho passes none and keeps row identity).
  const geotechPackingClassOf = useMemo(
    () =>
      packingClassOfFormations(geotechFormations),
    [geotechFormations],
  )

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
        packingClassOf: isGeotechTarget ? geotechPackingClassOf : undefined,
        // FRAME the geotech identity on the litho model — the picture the render
        // shows (owner ruling R6, debt #278). Litho passes no frame and keeps its
        // own whole-section partition. The project-open / nonce triggers below
        // defer until the litho layers load; the MANUAL toolbar recompute bypasses
        // that gate but is safe regardless — ``assembleSectionPartitionInput``
        // drops zero-layer columns, so an un-loaded (or genuinely empty) litho
        // model assembles to NO frames and the builder falls back to the
        // v2-identity arm per section.
        frameModelId: isGeotechTarget ? lithoModelId : undefined,
        frameLayers: isGeotechTarget ? lithoLayers : undefined,
      })
    },
    [
      projectId,
      geotechModelId,
      visibleSections,
      investigations,
      geotechLayers,
      lithoModelId,
      lithoLayers,
      geotechPackingClassOf,
    ],
  )

  // The geometry "4 · Divide boreholes" reads each borehole column off. Built
  // here because this hook already holds every input it needs; the boreholes
  // are named so the partition can exclude them (a divided borehole would
  // otherwise become a COLUMN and split the very gap it is supposed to stand
  // inside — see ``buildDividePartition``).
  const buildDividePartitionForSection = useCallback(
    async (sectionId: string): Promise<Record<string, unknown> | null> => {
      const section = visibleSections.find(s => s.id === sectionId) ?? null
      return assembleDividePartition({
        projectId,
        geotechModelId,
        section,
        investigations,
        layers: geotechLayers,
        boreholeInvestigationIds: new Set(visibleBoreholes.map(b => b.id)),
      }) as Promise<Record<string, unknown> | null>
    },
    [projectId, geotechModelId, visibleSections, investigations, geotechLayers, visibleBoreholes],
  )

  const { scheduleRecompute } = useBodyRecompute({
    projectId,
    buildPayload,
    dataLoaded: visibleSections.length > 0,
    toast,
  })

  // Module-ref bridge for the toolbar's "4 · Divide boreholes" verb. Assigned
  // every render so the ref is always current while the shell is mounted.
  sectionsDividePartitionCallback.current = buildDividePartitionForSection

  // Null the bridge ref on unmount so a toolbar click after this hook tears down
  // is a no-op rather than a call against a destroyed shell (debt #276). The
  // null is GUARDED — it fires only while the module ref still holds THIS
  // instance's callback — so an older instance's cleanup cannot wipe a ref a
  // newer instance has already claimed. ownedDivide tracks the value written
  // above (it changes identity across renders).
  const ownedDivide = useRef(buildDividePartitionForSection)
  ownedDivide.current = buildDividePartitionForSection
  useEffect(
    () => () => {
      if (sectionsDividePartitionCallback.current === ownedDivide.current)
        sectionsDividePartitionCallback.current = null
    },
    [],
  )

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
  // (an empty geotechLayers array is ambiguous without it). ALSO gated on the
  // litho FRAME being loaded (owner ruling R6, debt #278): the geotech identity
  // is the framed picture, so firing before the litho layers land would frame it
  // on an empty model. A closed litho gate leaves the once-marker unconsumed, so
  // the trigger re-fires when the layers load (the same event-driven rule). A
  // project genuinely without a litho model does not wait.
  useEffect(() => {
    if (projectId === null || geotechModelId === null) return
    if (visibleSections.length === 0 || !geotechLayersLoaded || geotechLayers.length === 0) return
    if (lithoModelId !== null && lithoLayers.length === 0) return
    const key = `${projectId}|${geotechModelId}`
    if (firedThisOpenRef.current.has(key)) return
    firedThisOpenRef.current.add(key)
    scheduleRecompute(geotechModelId)
  }, [projectId, geotechModelId, visibleSections.length, geotechLayersLoaded, geotechLayers.length, lithoModelId, lithoLayers.length, scheduleRecompute])

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
    // Wait for the litho FRAME (owner ruling R6, debt #278) — a bump arriving
    // before the frame loads is NOT consumed and re-fires when it does.
    if (lithoModelId !== null && lithoLayers.length === 0) return
    lastGeotechNonceRef.current = bodyRecomputeGeotechNonce
    scheduleRecompute(geotechModelId)
  }, [bodyRecomputeGeotechNonce, geotechModelId, visibleSections.length, geotechLayersLoaded, geotechLayers.length, lithoModelId, lithoLayers.length, scheduleRecompute])

  return { scheduleRecompute }
}
