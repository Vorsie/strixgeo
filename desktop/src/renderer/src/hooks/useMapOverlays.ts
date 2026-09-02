// Map overlay state — DEM hillshade + DOV Virtuele Boring predictions.
//
// Both overlays share the same ``project.view_state`` dependency (they
// each read a different key, but PATCH through the same endpoint), so
// they are co-located here to avoid a double-fetch of the same state.
//
// DEM source:
//   Derived from project.default_horizontal_epsg (Belgium → DHMVII,
//   NL → AHN). State lives in project.view_state.dem_overlay and
//   round-trips via the .gmproj bundle.
//
// Virtuele Boring:
//   Slot pair (modelA / modelB) lives in
//   project.view_state.virtuele_boring. Per-investigation predictions
//   are NOT persisted (they're a derived view; would bloat the file
//   with throwaway data); we refetch when either the active project or
//   the active models change. Per-pane visibility and model overrides
//   are localStorage-backed (per-user UI chrome, not a project
//   decision).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api/client'
import { log } from '../utils/log'
import { t } from '../i18n/translate'
import type {
  ProjectResponse,
  VirtueleBoringInvestigationPrediction,
} from '../api/client'
import {
  demSourceForEpsg,
  readDemOverlay,
  type DemOverlayState,
  type DemSource,
} from '../utils/demSources'
import {
  VIRTUELE_BORING_VIEW_STATE_KEY,
  activeOverlayModels,
  readPaneModelOverride,
  readPaneVisibility,
  readVirtueleBoringOverlay,
  writePaneModelOverride,
  writePaneVisibility,
  type VirtueleBoringOverlayState,
} from '../utils/virtueleBoringOverlay'

/** Payload accepted by the Virtuele Boring picker handler. */
export interface VirtueleBoringPickerPayload {
  modelA: string | null
  modelB: string | null
  maxDepthM: number | null
}

export interface UseMapOverlaysResult {
  // DEM
  demSource: DemSource | null
  demOverlay: DemOverlayState
  handleDemOverlayChange: (next: DemOverlayState) => Promise<void>
  // Virtuele Boring
  virtueleBoringOverlay: VirtueleBoringOverlayState
  virtueleBoringSectionModels: readonly string[]
  virtueleBoringPredictions: VirtueleBoringInvestigationPrediction[]
  virtueleBoringLoading: boolean
  virtueleBoringSkippedCount: number
  virtueleBoringPredictionByInvestigationId: ReadonlyMap<
    string,
    VirtueleBoringInvestigationPrediction
  >
  cptEffectiveModels: readonly string[]
  boreholeEffectiveModels: readonly string[]
  showOverlayOnSection: boolean
  showOverlayOnCpt: boolean
  showOverlayOnBorehole: boolean
  cptVirtueleBoringOverride: string
  boreholeVirtueleBoringOverride: string
  handleChangeVirtueleBoringPicker: (next: VirtueleBoringPickerPayload) => Promise<void>
  handleSetShowOverlay: (pane: 'section' | 'cpt' | 'borehole', next: boolean) => void
  handleSetOverlayOverride: (pane: 'cpt' | 'borehole', next: string) => void
  /**
   * Per-project "show confidence fade" toggle.  When true (default),
   * low-confidence TIN triangles + section dLow segments render at the
   * reduced ``LOW_CONFIDENCE_ALPHA_MULTIPLIER``.  When false, the
   * effective multiplier is 1.0 — every triangle / segment renders at
   * full alpha and the uncertainty cue disappears.
   *
   * Persisted in ``project.view_state.show_confidence_fade``; absent
   * (legacy projects) is treated as true.
   */
  showConfidenceFade: boolean
  /** Toggle setter that PATCHes view_state and surfaces a toast on failure. */
  handleSetShowConfidenceFade: (next: boolean) => Promise<void>
}

/**
 * React hook that owns the DEM hillshade and DOV Virtuele Boring overlay
 * state for the map and detail panes.
 *
 * Parameters
 * ----------
 * project
 *     The currently-loaded project. When ``null`` the overlays stay
 *     dormant — no fetches fire, no predictions are stored.
 * applyViewStatePatch
 *     Stable callback from ``useProject`` / ``useProjectLifecycle``
 *     that PATCHes ``/projects/{id}/view-state`` and keeps ``project``
 *     + ``saved`` in sync so the change does not flip the dirty flag.
 * toast
 *     Stable action from ``useToasts`` for surfacing fetch failures.
 *
 * Returns
 * -------
 * UseMapOverlaysResult
 *     All overlay state + action callbacks.
 */
export function useMapOverlays({
  project,
  applyViewStatePatch,
  toast,
}: {
  project: ProjectResponse | null
  applyViewStatePatch: (patch: Record<string, unknown>) => Promise<boolean>
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
}): UseMapOverlaysResult {
  // ---------------------------------------------------------------------------
  // DEM hillshade
  // ---------------------------------------------------------------------------

  const demSource = useMemo(
    () => demSourceForEpsg(project?.default_horizontal_epsg ?? null),
    [project?.default_horizontal_epsg],
  )
  const demOverlay = useMemo(
    () => readDemOverlay(project?.view_state),
    [project?.view_state],
  )
  const handleDemOverlayChange = useCallback(
    async (next: DemOverlayState): Promise<void> => {
      // Optimistic UI — the WMS layer flips on/off as fast as the
      // browser can mount the TileLayer. PATCH /view-state runs in
      // the background; failure surfaces a toast but the local UI
      // already reflects the new state. Subsequent saves will write
      // whatever the server has committed by then.
      const ok = await applyViewStatePatch({ dem_overlay: next })
      if (!ok) {
        toast('error', t('data.overlay.saveTerrainFailed'))
      }
    },
    // ``toast`` is a hoisted ``function`` declaration in App.tsx body —
    // stable across renders, omitted from deps to match the convention
    // used by every other callback there.
    [applyViewStatePatch],
  )

  // ---------------------------------------------------------------------------
  // Confidence fade toggle (debt #94/#28 follow-up — completes the user's
  // 2026-05-21 'do both' ask: stronger fade + the on/off toggle).
  // ---------------------------------------------------------------------------

  const showConfidenceFade = useMemo<boolean>(() => {
    const raw = (project?.view_state as Record<string, unknown> | undefined)?.[
      'show_confidence_fade'
    ]
    // Legacy projects without the key default to true (current shipped
    // behaviour — the fade is the on state).
    return raw === false ? false : true
  }, [project?.view_state])

  const handleSetShowConfidenceFade = useCallback(
    async (next: boolean): Promise<void> => {
      const ok = await applyViewStatePatch({ show_confidence_fade: next })
      if (!ok) {
        toast('error', t('data.overlay.saveConfidenceFadeFailed'))
      }
    },
    [applyViewStatePatch],
  )

  // ---------------------------------------------------------------------------
  // Virtuele Boring overlay
  // ---------------------------------------------------------------------------

  const virtueleBoringOverlay = useMemo(
    () => readVirtueleBoringOverlay(project?.view_state),
    [project?.view_state],
  )
  const virtueleBoringSectionModels = useMemo(
    () => activeOverlayModels(virtueleBoringOverlay),
    [virtueleBoringOverlay],
  )

  // Per-pane model overrides — empty string = follow section,
  // any other string = render only that model in the detail pane.
  // Seeded from localStorage on project change.
  const [cptVirtueleBoringOverride, setCptVirtueleBoringOverride] = useState('')
  const [boreholeVirtueleBoringOverride, setBoreholeVirtueleBoringOverride] =
    useState('')

  // Union of every requested model across all panes — drives the
  // predictions fetch. Without this, a detail-pane override for
  // hcovv2_S wouldn't have data to render (App fetches section's
  // models only otherwise). De-dup preserves the first occurrence
  // so section codes stay ahead of override-only codes.
  const virtueleBoringActiveModels = useMemo(() => {
    const out: string[] = []
    const seen = new Set<string>()
    const add = (code: string): void => {
      if (code && !seen.has(code)) {
        seen.add(code)
        out.push(code)
      }
    }
    for (const m of virtueleBoringSectionModels) add(m)
    if (cptVirtueleBoringOverride) add(cptVirtueleBoringOverride)
    if (boreholeVirtueleBoringOverride) add(boreholeVirtueleBoringOverride)
    return out
  }, [
    virtueleBoringSectionModels,
    cptVirtueleBoringOverride,
    boreholeVirtueleBoringOverride,
  ])

  // Effective models per pane — what each pane actually renders.
  // Override (when set) wins; otherwise the pane inherits the
  // section pane's pick. The section pane itself never has an
  // override — it IS the source.
  const cptEffectiveModels = useMemo<readonly string[]>(
    () =>
      cptVirtueleBoringOverride
        ? [cptVirtueleBoringOverride]
        : virtueleBoringSectionModels,
    [cptVirtueleBoringOverride, virtueleBoringSectionModels],
  )
  const boreholeEffectiveModels = useMemo<readonly string[]>(
    () =>
      boreholeVirtueleBoringOverride
        ? [boreholeVirtueleBoringOverride]
        : virtueleBoringSectionModels,
    [boreholeVirtueleBoringOverride, virtueleBoringSectionModels],
  )

  const [virtueleBoringPredictions, setVirtueleBoringPredictions] = useState<
    VirtueleBoringInvestigationPrediction[]
  >([])
  const [virtueleBoringLoading, setVirtueleBoringLoading] = useState(false)
  const [virtueleBoringSkippedCount, setVirtueleBoringSkippedCount] = useState(0)

  // Predictions cache — keyed on ``projectId:sortedModels`` so reselecting
  // a previously-loaded model set is instant. Invalidated when the project
  // changes (the ref is replaced with a new empty Map). A ref is used instead
  // of state because the cache itself is not render-triggering; cache hits
  // still call setVirtueleBoringPredictions to drive the UI update.
  const predictionsCacheRef = useRef<Map<string, VirtueleBoringInvestigationPrediction[]>>(
    new Map(),
  )

  // Stable string key for the current active model set — sorted so
  // ['hcovv2_S', 'hcovv2_Q'] and ['hcovv2_Q', 'hcovv2_S'] produce the
  // same key and deduplicate the fetch. The effect depends on this string
  // instead of the virtueleBoringActiveModels array reference so it does NOT
  // refire when the array is referentially-new but value-equal (which happens
  // whenever view_state produces a new object reference on project updates).
  const sortedActiveModelKey = useMemo(
    () => [...virtueleBoringActiveModels].sort().join(','),
    [virtueleBoringActiveModels],
  )

  // Invalidate the predictions cache when the project changes so stale
  // predictions from a previous project never bleed into the new one.
  const lastCacheProjectIdRef = useRef<string | null>(null)
  const projectId = project?.id ?? null
  if (lastCacheProjectIdRef.current !== projectId) {
    lastCacheProjectIdRef.current = projectId
    predictionsCacheRef.current = new Map()
  }

  useEffect(() => {
    // No project / no active models → keep the predictions empty so
    // the section view's ghost column overlay no-ops.
    if (!projectId || sortedActiveModelKey === '') {
      setVirtueleBoringPredictions([])
      setVirtueleBoringSkippedCount(0)
      return
    }

    // Cache hit — serve immediately without any network round-trip.
    const cacheKey = `${projectId}:${sortedActiveModelKey}`
    const cached = predictionsCacheRef.current.get(cacheKey)
    if (cached !== undefined) {
      setVirtueleBoringPredictions(cached)
      return
    }

    let cancelled = false
    setVirtueleBoringLoading(true)
    void (async () => {
      try {
        // Pass models in sorted order so the backend sees a stable list
        // regardless of which pane's override triggered the fetch.
        const models = sortedActiveModelKey.split(',')
        const result = await api.virtueleBoring.predictions(projectId, models)
        if (cancelled) return
        predictionsCacheRef.current.set(cacheKey, result.predictions)
        setVirtueleBoringPredictions(result.predictions)
        setVirtueleBoringSkippedCount(result.skipped_count)
      } catch (err) {
        if (cancelled) return
        // A failure here demotes the overlay to "off" visually — the
        // user keeps the rest of the app working. We don't toast on
        // every transient DOV blip; the section view + pane both
        // render their own "no predictions yet" copy.
        setVirtueleBoringPredictions([])
        setVirtueleBoringSkippedCount(0)
        log.warn('mapOverlays', 'virtuele boring predictions fetch failed', err)
      } finally {
        if (!cancelled) setVirtueleBoringLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, sortedActiveModelKey])

  // Per-pane visibility — localStorage-backed (per-user UI chrome).
  // Each pane keeps its own boolean so the user can show DOV on the
  // section view while keeping it off in the detail panes, or vice
  // versa. State seeded from localStorage on project change.
  // Declared before the picker/override handlers so they can close
  // over projectIdForOverlay and the setShow* setters without TDZ.
  const projectIdForOverlay = project?.id ?? null
  const [showOverlayOnSection, setShowOverlayOnSection] = useState(true)
  const [showOverlayOnCpt, setShowOverlayOnCpt] = useState(false)
  const [showOverlayOnBorehole, setShowOverlayOnBorehole] = useState(false)
  useEffect(() => {
    setShowOverlayOnSection(readPaneVisibility(projectIdForOverlay, 'section'))
    setShowOverlayOnCpt(readPaneVisibility(projectIdForOverlay, 'cpt'))
    setShowOverlayOnBorehole(readPaneVisibility(projectIdForOverlay, 'borehole'))
    setCptVirtueleBoringOverride(
      readPaneModelOverride(projectIdForOverlay, 'cpt'),
    )
    setBoreholeVirtueleBoringOverride(
      readPaneModelOverride(projectIdForOverlay, 'borehole'),
    )
  }, [projectIdForOverlay])

  const handleChangeVirtueleBoringPicker = useCallback(
    async (next: VirtueleBoringPickerPayload): Promise<void> => {
      const ok = await applyViewStatePatch({ [VIRTUELE_BORING_VIEW_STATE_KEY]: next })
      if (!ok) {
        toast('error', t('data.overlay.saveVirtueleBoringFailed'))
        return
      }
      // Selecting a model in the section picker auto-enables the section
      // overlay so it renders immediately without a second manual click.
      // When both slots are cleared (modelA and modelB both null) we leave
      // visibility unchanged so the user's last explicit hide is preserved.
      if (next.modelA || next.modelB) {
        writePaneVisibility(projectIdForOverlay, 'section', true)
        setShowOverlayOnSection(true)
      }
    },
    // reason: ``toast`` is injected from useToasts — a render-stable
    // function; adding it to deps would re-bind this callback every
    // render with no behaviour change. eslint can't see that stability,
    // so the suppression is the documented CLAUDE.md form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyViewStatePatch, projectIdForOverlay],
  )

  const handleSetOverlayOverride = useCallback(
    (pane: 'cpt' | 'borehole', next: string): void => {
      writePaneModelOverride(projectIdForOverlay, pane, next)
      if (pane === 'cpt') setCptVirtueleBoringOverride(next)
      else setBoreholeVirtueleBoringOverride(next)
      // Selecting a model auto-enables visibility for that pane so the
      // overlay renders immediately without a second manual click on the
      // DOV toggle. The user can still hide it afterward via the toggle.
      // Clearing the override (next === '') leaves visibility unchanged
      // so the user's explicit hide decision is preserved.
      if (next) {
        writePaneVisibility(projectIdForOverlay, pane, true)
        if (pane === 'cpt') setShowOverlayOnCpt(true)
        else setShowOverlayOnBorehole(true)
      }
    },
    [projectIdForOverlay],
  )
  const handleSetShowOverlay = useCallback(
    (pane: 'section' | 'cpt' | 'borehole', next: boolean): void => {
      writePaneVisibility(projectIdForOverlay, pane, next)
      if (pane === 'section') setShowOverlayOnSection(next)
      else if (pane === 'cpt') setShowOverlayOnCpt(next)
      else setShowOverlayOnBorehole(next)
    },
    [projectIdForOverlay],
  )

  // Index predictions by investigation id once at the hook level so
  // both the section view (looking up each visible column) and the
  // detail panes (looking up the one selected investigation) hit a
  // single Map lookup.
  const virtueleBoringPredictionByInvestigationId = useMemo(() => {
    const map = new Map<string, VirtueleBoringInvestigationPrediction>()
    for (const pred of virtueleBoringPredictions) {
      map.set(pred.investigation_id, pred)
    }
    return map
  }, [virtueleBoringPredictions])

  return {
    demSource,
    demOverlay,
    handleDemOverlayChange,
    virtueleBoringOverlay,
    virtueleBoringSectionModels,
    virtueleBoringPredictions,
    virtueleBoringLoading,
    virtueleBoringSkippedCount,
    virtueleBoringPredictionByInvestigationId,
    cptEffectiveModels,
    boreholeEffectiveModels,
    showOverlayOnSection,
    showOverlayOnCpt,
    showOverlayOnBorehole,
    cptVirtueleBoringOverride,
    boreholeVirtueleBoringOverride,
    handleChangeVirtueleBoringPicker,
    handleSetShowOverlay,
    handleSetOverlayOverride,
    showConfidenceFade,
    handleSetShowConfidenceFade,
  }
}
