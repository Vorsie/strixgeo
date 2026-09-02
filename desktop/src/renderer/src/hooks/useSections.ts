// Cross-section state and mutation handlers.
//
// Owns the sections list, selection, drawing mode, focused-contacts
// highlight, and all CRUD handlers (create via line-draw, delete,
// patch). Also owns the manifest/session-import bookkeeping for new
// and deleted sections — the lifecycle callbacks that were inline in
// App.tsx as handleSectionCreated / handleSectionDeleted now live here
// alongside the handlers that call them.
//
// ``handleFocusContacts`` reads the contacts + investigations lists to
// resolve which section contains the offending anchors. Those lists are
// dep-injected so the hook stays independent of the data-loading hooks.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import { api } from '../api/client'
import type { CrossSectionResponse, FormationContactResponse } from '../api/client'
import { addAllToSet } from '../utils/sets'
import { projectPointOntoLine } from '../utils/sectionProjection'
import { wgs84ToProjected } from './useWgs84'
import { log } from '../utils/log'
import { t } from '../i18n/translate'
import { readSectionDefaults } from '../utils/sectionDefaults'
import { suggestTieSections, type SuggestedTie, type TieInvestigation } from '../utils/tieAutoSuggest'
import type { UndoCommand } from './useUndoStack'
import type { FocusTarget } from '../components/sections/useFocusColumn'
import { useCorrelate } from '../components/sections/useCorrelate'
import type { CorrelationSource } from '../components/sections/useCorrelate'

/** Which model the section editor renders and edits (slice 2, #55). */
export type SectionModelAxis = 'geological' | 'lithostratigraphic' | 'geotechnical'

export interface UseSectionsResult {
  sections: CrossSectionResponse[]
  selectedSectionId: string | null
  drawingSection: boolean
  focusedContactIds: readonly string[]
  visibleSections: CrossSectionResponse[]
  /**
   * The CRS new sections will be created in: the project's
   * ``default_horizontal_epsg`` when set, else the first imported
   * investigation's ``epsg``, else ``null`` (no CRS anywhere — section
   * creation is genuinely not possible and the affordances disable).
   */
  effectiveHorizontalEpsg: number | null
  /**
   * Which model the section editor renders and edits.  Defaults to
   * ``'geological'`` — zero regression.  Toggled by the
   * ``SectionsToolbar`` geology↔lithology segmented control.
   *
   * Session-only: NOT persisted to the .gmproj bundle (reversible UI
   * state — resets to ``'geological'`` on project close / reopen).
   */
  sectionModelAxis: SectionModelAxis
  /** Toggle the section model axis (geological ↔ lithostratigraphic). */
  setSectionModelAxis: (axis: SectionModelAxis) => void
  /**
   * Override the geological model used as the backdrop reference on the litho
   * axis.  ``null`` = use the litho model's parent (the default derivation in
   * SectionsCanvas).  Only relevant when the project has more than one
   * geological model; SectionsInspector renders the picker in that case.
   */
  backdropModelIdOverride: string | null
  /** Set or clear the backdrop model override. */
  setBackdropModelIdOverride: (id: string | null) => void
  // Section data
  refreshSectionList: () => Promise<void>
  // Clear the section selection from outside the hook (e.g. when a CPT
  // or borehole is selected the section panel must close). Callers that
  // own the CPT/borehole selection inject this to avoid coupling.
  clearSectionSelection: () => void
  // Section lifecycle — manifest + session-imports bookkeeping
  handleSectionCreated: (id: string) => void
  handleSectionDeleted: (id: string) => void
  // Section CRUD
  handleCreateSection: () => Promise<CrossSectionResponse | null>
  cancelSectionDraw: () => void
  handleSectionLineDrawn: (
    start: { lat: number; lng: number },
    end: { lat: number; lng: number },
  ) => Promise<void>
  handleDeleteSection: (id: string) => Promise<void>
  handlePatchSelectedSection: (patch: {
    name?: string
    projection_buffer_m?: number
    vertical_exaggeration?: number
    view_state?: Record<string, unknown>
    excluded_cpt_ids?: string[]
    excluded_borehole_ids?: string[]
  }) => Promise<void>
  handleSelectSection: (id: string) => void
  /**
   * Highlight + select the cross-section containing the given offending
   * contacts.
   *
   * Default resolution: find the first section whose buffer contains any
   * of the contacts' anchors, preferring the currently-selected section.
   *
   * When ``targetSectionId`` is provided, the auto-resolution is bypassed
   * and the named section is used verbatim — the crossings-banner click
   * flow sets this explicitly so the AppShell deep-link dispatches to
   * the section the user picked (avoids a race with the hook's own
   * "prefer current" logic during the sections-stage transition).
   *
   * When ``axisOverride`` is provided, the contact set searched is chosen by
   * that axis rather than the axis the section currently shows. The
   * "Edit in Geology stage" deep-link (#156) fires from the LITHO axis but
   * hands a GEOLOGICAL contact id, so without the override the axis-gate
   * (see the body) searches ``lithoContacts``, misses, and fires the
   * "couldn't find the contact" toast. Stating the contact's own axis lets
   * it resolve regardless of what the section is displaying.
   */
  handleFocusContacts: (
    contactIds: readonly string[],
    targetSectionId?: string,
    axisOverride?: SectionModelAxis,
  ) => void
  /**
   * Apply a fully-resolved section row returned by the server (e.g. the
   * ``updated_section`` from a Seed response or the section patched after a
   * manual contact draw) to local state without a round-trip GET.
   *
   * Replaces the matching entry in the ``sections`` list by id.  No-ops
   * when the id is not found (defensive: Seed could theoretically return
   * a section from a different project if something went wrong server-side).
   */
  applyUpdatedSection: (updated: CrossSectionResponse) => void
  /**
   * The column currently focused inside the active ``SectionPanel``, or
   * ``null`` when nothing is focused / no section is open.
   *
   * Set via right-click → "Focus" in the section canvas and lifted to
   * the shell so ``SectionsToolbar`` can use the section-local focus for
   * the litho-axis "Suggest litho" button (instead of the global
   * ``coordinator.selectedId`` / ``selectedBoreholeId``, which are only
   * set by map/data-stage interactions, not by section-canvas right-clicks).
   */
  sectionFocusedColumn: FocusTarget | null
  /**
   * Update ``sectionFocusedColumn`` — called via ``SectionPanel``'s
   * ``onFocusedColumnChange`` prop whenever the user right-clicks a
   * column to focus it or exits focus mode.
   */
  setSectionFocusedColumn: (col: FocusTarget | null) => void

  // ---------------------------------------------------------------------------
  // Correlate mode (Slice 4, #67-area).
  // Transient UI state — never persisted to .gmproj. Cleared on axis switch
  // and when the selected section changes.
  // ---------------------------------------------------------------------------
  /** Whether correlate mode is active on the litho axis. */
  correlateMode: boolean
  /** The armed source unit, or null when mode is on but nothing is armed. */
  correlationSource: CorrelationSource | null
  /** Enter correlate mode (no-op when already in mode). */
  enterCorrelateMode: () => void
  /** Exit correlate mode and clear armed state. */
  exitCorrelateMode: () => void
  /** Arm a source unit. Replaces any prior source. */
  armCorrelationSource: (source: CorrelationSource) => void
  /** Clear armed source without exiting mode (Esc layer 1). */
  clearCorrelationSource: () => void

  // ---------------------------------------------------------------------------
  // Tie-section suggestion state + handlers (Task 4).
  // Ghost-display candidates proposed by ``suggestTieSections``; accepted
  // via ``handleAcceptTie`` which creates a real section by the same path
  // as ``handleSectionLineDrawn``.
  // ---------------------------------------------------------------------------
  /** Auto-proposed tie-sections, shown as ghosts on the map. */
  suggestedTies: SuggestedTie[]
  /** Run the suggestion algorithm and populate ``suggestedTies``. */
  handleSuggestTies: (cpts: TieInvestigation[], boreholes: TieInvestigation[]) => void
  /** Accept one proposed tie: POST it as a real section, remove from the ghost list. */
  handleAcceptTie: (index: number) => Promise<void>
  /** Accept all proposed ties in a single batch POST; clears the ghost list on success. */
  handleAcceptAllTies: () => Promise<void>
  /** Dismiss one proposed tie without creating a section. */
  handleRejectTie: (index: number) => void
  /** Dismiss all proposed ties. */
  handleClearTieSuggestions: () => void

}

/** Shape of a borehole list-item as seen by the hook (x/y only needed). */
interface BoreholeAnchor {
  id: string
  location_x: number | null
  location_y: number | null
  // The investigation's own horizontal CRS. Used as the fallback
  // section CRS when the project metadata never set one (e.g. a DOV
  // import that didn't populate default_horizontal_epsg).
  epsg?: number | null
}

/** Shape of a CPT list-item as seen by the hook (x/y only needed). */
interface CptAnchor {
  id: string
  location_x: number | null
  location_y: number | null
  epsg?: number | null
}

/**
 * Build the section-create payload for one accepted tie suggestion —
 * shared by the single accept and accept-all paths so the field set
 * cannot drift between them. Only the ordinal (name suffix) differs
 * per caller.
 *
 * @param tie - The accepted tie-section suggestion.
 * @param ordinal - 1-based ordinal used in the "Tie-section N" name.
 * @param epsg - Effective horizontal CRS for the new section.
 * @param verticalExaggeration - Default vertical exaggeration from settings.
 * @returns Payload for ``api.section.create`` / ``createBatch``.
 */
function tieToCreatePayload(
  tie: SuggestedTie,
  ordinal: number,
  epsg: number,
  verticalExaggeration: number,
): {
  name: string
  epsg: number
  start_x: number
  start_y: number
  end_x: number
  end_y: number
  projection_buffer_m: number
  vertical_exaggeration: number
} {
  return {
    name: `Tie-section ${ordinal}`,
    epsg,
    start_x: tie.start.x,
    start_y: tie.start.y,
    end_x: tie.end.x,
    end_y: tie.end.y,
    projection_buffer_m: tie.bufferM,
    vertical_exaggeration: verticalExaggeration,
  }
}

/**
 * React hook that manages cross-section state and handlers.
 *
 * Parameters
 * ----------
 * project
 *     Active project.  When ``null`` all state is reset to empty.
 * ready
 *     From ``useAppBoot`` — data loading waits until the API is up.
 * toast
 *     Stable action from ``useToasts`` for surfacing API failures.
 * pushUndo
 *     Stable action from ``useUndoStack`` for recording reversible mutations.
 * manifestSectionIds
 *     From ``useProject`` — the set of section ids currently in the bundle.
 *     Used to gate ``visibleSections``.
 * addToManifest
 *     From ``useProject`` — appends newly-created section ids to the bundle.
 * removeFromManifest
 *     From ``useProject`` — removes deleted section ids from the bundle.
 * setSessionImportSectionIds
 *     The ``usePersistedSet`` setter for session-imported section ids.
 *     Injected directly so the hook doesn't own the set state itself.
 * contacts
 *     From ``useGeologicalModel`` — needed by ``handleFocusContacts``
 *     to resolve which contacts anchor crossing issues.
 * boreholes
 *     List of boreholes in the project — needed for anchor-point lookup
 *     in ``handleFocusContacts``.
 * cpts
 *     List of CPTs in the project — needed for anchor-point lookup in
 *     ``handleFocusContacts``.
 * setSelectedId
 *     App-level CPT selection setter — cleared when a section is selected.
 * setSelectedBoreholeId
 *     App-level borehole selection setter — cleared when a section is selected.
 *
 * Returns
 * -------
 * UseSectionsResult
 *     All section state + action callbacks.
 */
export function useSections({
  project,
  ready,
  toast,
  pushUndo,
  requestBodyRecompute,
  manifestSectionIds,
  addToManifest,
  removeFromManifest,
  setSessionImportSectionIds,
  contacts,
  lithoContacts,
  boreholes,
  cpts,
  setSelectedId,
  setSelectedBoreholeId,
}: {
  project: {
    id: string
    default_horizontal_epsg: number | null
    name: string
    /** Bag of UI-chrome decisions persisted in the .gmproj — used here
     *  for the per-project section create-time defaults (buffer / V-exag).
     *  Optional so test fixtures don't all have to wire it; absent /
     *  null falls through to the global defaults. */
    view_state?: Record<string, unknown> | null
  } | null
  /** From ``useAppBoot`` — data loading waits until the API is up. */
  ready: boolean
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
  pushUndo: (cmd: UndoCommand) => void
  /**
   * Schedule the body-identity recompute for a model axis (slice 5). A section
   * create/delete adds/removes a whole partition, so BOTH axes' geometry moves.
   * Optional so hand-rolled test fixtures need not supply it.
   */
  requestBodyRecompute?: (kind: 'litho' | 'geotech') => void
  manifestSectionIds: ReadonlySet<string>
  addToManifest: (kind: 'section', ids: string[]) => void
  removeFromManifest: (kind: 'section', ids: Iterable<string>) => void
  // React's full SetStateAction shape — accepts both direct values
  // and updater functions. The narrower updater-only form rejected
  // the wider helpers (utils/sets.addAllToSet) at the type boundary.
  setSessionImportSectionIds: Dispatch<SetStateAction<Set<string>>>
  contacts: FormationContactResponse[]
  /**
   * Litho contact list (slice 2, #55) — dep-injected so the hook stays
   * independent of how the litho state is loaded.  Used by
   * ``handleFocusContacts`` when the section axis is 'lithostratigraphic'.
   */
  lithoContacts: FormationContactResponse[]
  boreholes: readonly BoreholeAnchor[]
  cpts: readonly CptAnchor[]
  setSelectedId: (id: string | null) => void
  setSelectedBoreholeId: (id: string | null) => void
}): UseSectionsResult {
  const [sections, setSections] = useState<CrossSectionResponse[]>([])
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  // Slice 2 (#55): which model the editor renders. Defaults to geological —
  // zero regression. Session-only (not persisted to .gmproj).
  const [sectionModelAxis, _setSectionModelAxis] = useState<SectionModelAxis>('geological')
  // Geological backdrop model override (#60). Null = use the active litho
  // model's parent_model_id (derived in SectionsCanvas). Only
  // relevant when the project has more than one geological model. Session-only.
  const [backdropModelIdOverride, setBackdropModelIdOverride] = useState<string | null>(null)
  // Section-local focused column — set by right-click → "Focus" in the
  // SectionPanel canvas. Lifted here so SectionsToolbar can use it for
  // the litho-axis "Suggest litho" button without going through the
  // global coordinator selection (which is only set by map/data clicks).
  // Session-only: reset when the section changes.
  const [sectionFocusedColumn, setSectionFocusedColumn] = useState<FocusTarget | null>(null)
  // Reset the focused column whenever the selected section changes so
  // a stale focus from section A doesn't carry over to section B.
  const prevSectionIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (selectedSectionId !== prevSectionIdRef.current) {
      prevSectionIdRef.current = selectedSectionId
      setSectionFocusedColumn(null)
    }
  }, [selectedSectionId])

  // Correlate mode (Slice 4). Transient — session-only, not persisted.
  // Cleared when the axis switches (via setSectionModelAxis callers) or
  // when the selected section changes.
  // Single source of truth for the correlate state machine: delegate to
  // useCorrelate (review B1 — useSections previously re-implemented an
  // identical machine, leaving the hook + its 8 unit tests testing dead
  // code while the two copies could silently diverge). useSections owns
  // only the bus-level side effects the hook intentionally does not:
  // clearing on section change / axis switch.
  const {
    correlateMode,
    correlationSource,
    enterMode: enterCorrelateMode,
    exitMode: exitCorrelateMode,
    arm: armCorrelationSource,
    clearArmed: clearCorrelationSource,
  } = useCorrelate()
  // Clear correlate state when the section changes (a stale armed source
  // would reference a band that doesn't exist on the new section).
  useEffect(() => {
    exitCorrelateMode()
  }, [selectedSectionId, exitCorrelateMode])
  // Wrap the axis setter to also exit correlate mode — switching axes
  // leaves the armed source referencing a band that doesn't exist on
  // the new axis (the geological axis has no litho unit bands).
  const setSectionModelAxis = useCallback(
    (axis: SectionModelAxis) => {
      _setSectionModelAxis(axis)
      exitCorrelateMode()
    },
    [exitCorrelateMode],
  )
  // Two-click draw mode — active while the user is placing a section
  // line on the map. Set by handleCreateSection, cleared by
  // cancelSectionDraw and handleSectionLineDrawn.
  const [drawingSection, setDrawingSection] = useState(false)
  // Contact ids highlighted in the active cross-section. Driven by
  // clicks on the crossings banner (debt #9). Cleared after 2.5 s.
  const [focusedContactIds, setFocusedContactIds] = useState<readonly string[]>([])
  const focusedContactsTimeoutRef = useRef<number | null>(null)
  // Auto-proposed tie-sections shown as ghosts on the map (Task 4).
  // Populated by handleSuggestTies; consumed by the map overlay.
  const [suggestedTies, setSuggestedTies] = useState<SuggestedTie[]>([])

  // ---------------------------------------------------------------------------
  // Effective horizontal CRS for new sections.
  //
  // Section endpoints must be stored in a projected CRS. The project's
  // ``default_horizontal_epsg`` is the intended source, but a DOV/GEF
  // import doesn't always populate it — leaving section creation
  // hard-blocked even though every imported investigation carries its
  // own ``epsg``. Fall back to the first investigation's CRS so the
  // user isn't dead-ended on an unfilled metadata dropdown. Only truly
  // null when there is no project CRS AND no investigation with a CRS.
  // ---------------------------------------------------------------------------
  const effectiveHorizontalEpsg = useMemo<number | null>(() => {
    if (project?.default_horizontal_epsg != null) {
      return project.default_horizontal_epsg
    }
    for (const b of boreholes) {
      if (b.epsg != null) return b.epsg
    }
    for (const c of cpts) {
      if (c.epsg != null) return c.epsg
    }
    return null
  }, [project, boreholes, cpts])

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  const refreshSectionList = useCallback(async () => {
    if (!project) return
    try {
      const list = await api.section.list(project.id)
      setSections(list)
      log.debug('section', `refreshList: ${list.length} sections`)
    } catch (err) {
      log.error('section', 'refreshList failed', err)
      toast('error', t('sections.toast.loadFailed'))
    }
  }, [project])

  // Auto-load sections whenever the API is ready and a project is open.
  // Mirrors the CPT/borehole auto-load in useInvestigationData so all
  // three lists refresh on project switch without App coordinating them.
  //
  // WHY unconditional clear (S6 fix): clearing only on project=null leaves
  // A's sections in state during an A→B project switch.  Between the effect
  // firing (project?.id changes) and the new fetch resolving, a stale
  // sections list is visible:
  //   - handleSectionLineDrawn reads sections.length for the ordinal → wrong
  //     Cross-section N (counts A's sections, not B's).
  //   - handleFocusContacts searches sections → resolves to A's section rows.
  // Clearing unconditionally at the top of the effect ensures every project
  // transition (null OR A→B) starts from an empty list regardless of whether
  // a project is present.  This also covers the original null-close fix.
  //
  // NOTE: useInvestigationData has an identical A→B gap (clears only on null);
  // that is pre-existing and out of scope here — tracked as Tier-E debt.
  useEffect(() => {
    // Clear immediately on every project transition (including A→B switches).
    setSections([])
    // Ghost tie suggestions are ephemeral + geometry-specific to the project
    // they were computed from; drop them so project A's ghosts never paint
    // over project B's map.
    setSuggestedTies([])
    if (!project) return
    if (ready) {
      void refreshSectionList()
    }
    // reason: refreshSectionList is stable when project is stable; its
    // identity changes only when project changes, which is already
    // captured via project?.id. Including the callback itself would
    // fire an extra fetch on every unrelated dep change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, project?.id])

  // Manifest gate: only ids present in the .gmproj bundle are visible.
  // Sections created in a previous session and never saved vanish on
  // the next open — same policy as CPTs and boreholes.
  //
  // WHY visibleSections is the canonical set for BOTH the map overlay and the
  // right-pane list: the map must show only the sections the user has saved
  // (or drawn in this session before saving).  Feeding raw `sections` to the
  // map while the list reads visibleSections creates a visible desync — the
  // map showed unsaved sections that the list said were absent.  Both
  // DataCanvas and SectionsCanvas now pass visibleSections to MapView.
  //
  // WHY useMemo (S7 fix): a plain `const sections.filter(…)` produces a new
  // array identity on every render — any component that receives visibleSections
  // as a prop or effect dep re-renders / re-fires the effect on every render
  // cycle, creating the documented S7-class re-render / loop risk.
  //
  // manifestSectionIds stability: the prop is a ReadonlySet<string> injected
  // from useProject.  useProject builds it with useMemo keyed on the bundle's
  // sections array (a stable JSON-parsed reference), so its identity is stable
  // across renders that don't mutate the bundle.  handleSectionCreated and
  // handleSectionDeleted each call addToManifest/removeFromManifest which
  // produce a new Set, so the identity correctly changes only when the manifest
  // actually changes — no extra renders.
  const visibleSections = useMemo(
    () => sections.filter(s => manifestSectionIds.has(s.id)),
    [sections, manifestSectionIds],
  )

  // ---------------------------------------------------------------------------
  // Lifecycle callbacks — manifest + session-imports bookkeeping
  // ---------------------------------------------------------------------------

  const handleSectionCreated = useCallback(
    (id: string) => {
      addToManifest('section', [id])
      addAllToSet(setSessionImportSectionIds, [id])
    },
    [addToManifest, setSessionImportSectionIds],
  )

  const handleSectionDeleted = useCallback(
    (id: string) => {
      removeFromManifest('section', [id])
      setSessionImportSectionIds(prev => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    },
    [removeFromManifest, setSessionImportSectionIds],
  )

  // ---------------------------------------------------------------------------
  // CRUD handlers
  // ---------------------------------------------------------------------------

  // Enter two-click draw mode. The Sidebar's "+ New cross-section"
  // button fires this; the map mounts a SectionLineDrawer that calls
  // handleSectionLineDrawn once both endpoints are placed.
  //
  // Returning ``null`` satisfies the SectionList's create-callback
  // contract (the row materialises asynchronously after drawing).
  const handleCreateSection = useCallback(async (): Promise<CrossSectionResponse | null> => {
    if (!project) return null
    if (effectiveHorizontalEpsg == null) {
      toast('error', t('sections.toast.noCrs'))
      return null
    }
    // Drop any active section / CPT / borehole selection so the map is
    // the sole visible surface for drawing.
    setSelectedSectionId(null)
    setSelectedId(null)
    setSelectedBoreholeId(null)
    setDrawingSection(true)
    return null
  }, [project, effectiveHorizontalEpsg, toast, setSelectedId, setSelectedBoreholeId])

  const cancelSectionDraw = useCallback(() => {
    setDrawingSection(false)
  }, [])

  // Fired by the SectionLineDrawer once both endpoints are placed.
  // Converts WGS84 (Leaflet's native CRS) → the project's EPSG, POSTs
  // the section, updates local state, and registers an undo command.
  const handleSectionLineDrawn = useCallback(
    async (
      start: { lat: number; lng: number },
      end: { lat: number; lng: number },
    ) => {
      setDrawingSection(false)
      if (!project) return
      const epsg = effectiveHorizontalEpsg
      if (epsg == null) return // gated upstream, defensive only
      const [sx, sy] = wgs84ToProjected(start.lat, start.lng, epsg)
      const [ex, ey] = wgs84ToProjected(end.lat, end.lng, epsg)
      // Reject zero-length lines before hitting the backend.
      if (sx === ex && sy === ey) {
        toast('error', t('sections.toast.sameEndpoints'))
        return
      }
      // WHY visibleSections, not sections: `sections` is the raw DB list and
      // includes orphan rows from previous sessions that were never saved into
      // the .gmproj manifest.  Naming from `sections.length` produced
      // "Cross-section 3" when the user had drawn 2 sections and not saved —
      // the 3rd draw would be the 1st visible one.  Ordinal must reflect what
      // the user SEES (manifest-gated), not what exists in the DB.
      const ordinal = visibleSections.length + 1
      // Per-project create-time defaults (File → Settings → Cross-sections).
      // Backend has its own defaults (50 m / 1.0×); we send the project's
      // override only when present so unconfigured projects keep the
      // backend default.
      const sectionDefaults = readSectionDefaults(project.view_state ?? null)
      try {
        const createPayload = {
          name: `Cross-section ${ordinal}`,
          epsg,
          start_x: sx,
          start_y: sy,
          end_x: ex,
          end_y: ey,
          projection_buffer_m: sectionDefaults.bufferM,
          vertical_exaggeration: sectionDefaults.verticalExaggeration,
        }
        const created = await api.section.create(project.id, createPayload)
        setSections(prev => [...prev, created])
        setSelectedSectionId(created.id)
        handleSectionCreated(created.id)
        // A new section adds a whole partition, so BOTH model axes' body
        // geometry moved (slice 5).
        requestBodyRecompute?.('litho')
        requestBodyRecompute?.('geotech')
        log.success('section', `created ${created.name} from map draw`)
        const projectId = project.id
        let currentId = created.id
        pushUndo({
          description: 'Create cross-section',
          revert: async () => {
            await api.section.delete(projectId, currentId)
            setSections(prev => prev.filter(s => s.id !== currentId))
            setSelectedSectionId(prev => (prev === currentId ? null : prev))
            requestBodyRecompute?.('litho')
            requestBodyRecompute?.('geotech')
          },
          reapply: async () => {
            const recreated = await api.section.create(projectId, createPayload)
            currentId = recreated.id
            setSections(prev => [...prev, recreated])
            setSelectedSectionId(recreated.id)
            handleSectionCreated(recreated.id)
            requestBodyRecompute?.('litho')
            requestBodyRecompute?.('geotech')
          },
        })
      } catch (err) {
        log.error('section', 'create-from-draw failed', err)
        toast('error', t('sections.toast.createFailed'))
      }
    },
    [project, effectiveHorizontalEpsg, visibleSections.length, handleSectionCreated, pushUndo, requestBodyRecompute],
  )

  const handleDeleteSection = useCallback(
    async (id: string) => {
      if (!project) return
      try {
        // Snapshot the section so undo can re-POST an equivalent.
        const snapshot = sections.find(s => s.id === id)
        if (!snapshot) return
        await api.section.delete(project.id, id)
        setSections(prev => prev.filter(s => s.id !== id))
        if (selectedSectionId === id) setSelectedSectionId(null)
        handleSectionDeleted(id)
        // Removing a section removes its whole partition from both axes (slice 5).
        requestBodyRecompute?.('litho')
        requestBodyRecompute?.('geotech')
        log.info('section', `deleted ${id}`)
        const projectId = project.id
        const recreatePayload = {
          name: snapshot.name,
          description: snapshot.description,
          epsg: snapshot.epsg,
          start_x: snapshot.start_x,
          start_y: snapshot.start_y,
          end_x: snapshot.end_x,
          end_y: snapshot.end_y,
          projection_buffer_m: snapshot.projection_buffer_m,
          vertical_exaggeration: snapshot.vertical_exaggeration,
        }
        let currentId: string | null = null
        pushUndo({
          description: 'Delete cross-section',
          revert: async () => {
            const recreated = await api.section.create(projectId, recreatePayload)
            currentId = recreated.id
            setSections(prev => [...prev, recreated])
            handleSectionCreated(recreated.id)
            requestBodyRecompute?.('litho')
            requestBodyRecompute?.('geotech')
          },
          reapply: async () => {
            if (!currentId) return
            await api.section.delete(projectId, currentId)
            const deletedId = currentId
            setSections(prev => prev.filter(s => s.id !== deletedId))
            setSelectedSectionId(prev => (prev === deletedId ? null : prev))
            currentId = null
            requestBodyRecompute?.('litho')
            requestBodyRecompute?.('geotech')
          },
        })
      } catch (err) {
        log.error('section', `delete ${id} failed`, err)
        toast('error', t('sections.toast.deleteFailed'))
      }
    },
    [
      project,
      selectedSectionId,
      handleSectionDeleted,
      handleSectionCreated,
      sections,
      pushUndo,
      requestBodyRecompute,
    ],
  )

  // PATCH the currently-selected section. Used by the SectionPanel's
  // buffer + VEX sliders (fires on release, not every pixel of drag,
  // to avoid hammering the backend), and by the inspector's inline
  // name editor (commits on blur/Enter). Updates local state with the
  // row the server returns so subsequent renders use the server-truth value.
  const handlePatchSelectedSection = useCallback(
    async (patch: {
      name?: string
      projection_buffer_m?: number
      vertical_exaggeration?: number
      view_state?: Record<string, unknown>
      excluded_cpt_ids?: string[]
      excluded_borehole_ids?: string[]
    }) => {
      if (!project || !selectedSectionId) return
      try {
        const updated = await api.section.update(project.id, selectedSectionId, patch)
        setSections(prev => prev.map(s => (s.id === updated.id ? updated : s)))
        log.debug('section', `patched ${selectedSectionId} → ${JSON.stringify(patch)}`)
      } catch (err) {
        log.error('section', `patch ${selectedSectionId} failed`, err)
        toast('error', t('sections.toast.saveFailed'))
      }
    },
    [project, selectedSectionId],
  )

  // Cross-section selection — exclusive with CPT + borehole. Clearing
  // the others on entry means the existing view-tab logic doesn't need
  // to know about sections.
  const handleSelectSection = useCallback(
    (id: string) => {
      setSelectedSectionId(id)
      setSelectedId(null)
      setSelectedBoreholeId(null)
    },
    [setSelectedId, setSelectedBoreholeId],
  )

  // Banner click → focus the offending contacts in a section view.
  // Resolves which section contains one of the contact anchors
  // (preferring the currently-selected section), opens it, sets
  // focusedContactIds for the ContactsLayer ring + pulse. Cleared
  // after 2.5 s. debt #9.
  const handleFocusContacts = useCallback(
    (
      contactIds: readonly string[],
      targetSectionId?: string,
      axisOverride?: SectionModelAxis,
    ) => {
      if (contactIds.length === 0) return
      // Slice 2 (#55): search the contact set that matches the active axis so
      // "focus crossing" still works when the litho axis is active. The
      // crossings validator runs on the geological model; on the litho axis the
      // banner won't fire, but the handler is future-proof for litho crossings.
      //
      // #156: the "Edit in Geology stage" deep-link overrides the axis because
      // it fires from the litho axis but focuses a geological contact — without
      // the override this lookup would miss and toast "couldn't find". The
      // override also sidesteps the stale-axis closure the deep-link would
      // otherwise capture (the axis it states is passed by value, not read from
      // this callback's captured ``sectionModelAxis``).
      const effectiveAxis = axisOverride ?? sectionModelAxis
      const activeContacts =
        effectiveAxis === 'lithostratigraphic' ? lithoContacts : contacts
      const offending = activeContacts.filter(c => contactIds.includes(c.id))
      if (offending.length === 0) {
        toast('error', t('sections.toast.contactNotFound'))
        return
      }
      // Resolve each contact's anchor (x, y) from the loaded lists.
      const anchorPoints: Array<{ x: number; y: number }> = []
      for (const c of offending) {
        if (c.borehole_id) {
          const bh = boreholes.find(b => b.id === c.borehole_id)
          if (bh && bh.location_x !== null && bh.location_y !== null) {
            anchorPoints.push({ x: bh.location_x, y: bh.location_y })
          }
        } else if (c.cpt_id) {
          const cpt = cpts.find(p => p.id === c.cpt_id)
          if (cpt && cpt.location_x !== null && cpt.location_y !== null) {
            anchorPoints.push({ x: cpt.location_x, y: cpt.location_y })
          }
        }
      }
      const sectionContains = (s: CrossSectionResponse): boolean =>
        anchorPoints.some(p => {
          const proj = projectPointOntoLine(s, p.x, p.y)
          return proj !== null && Math.abs(proj.offset) <= s.projection_buffer_m
        })
      let target: CrossSectionResponse | null
      if (targetSectionId !== undefined) {
        // Explicit section — the crossings-banner deep-link path sets
        // this so the user's picked section is used verbatim, bypassing
        // the "prefer current" heuristic below.
        target = sections.find(s => s.id === targetSectionId) ?? null
      } else {
        // Prefer the section the user is already viewing so the viewport
        // stays stable when the offending contact is already in sight.
        const current = selectedSectionId
          ? sections.find(s => s.id === selectedSectionId) ?? null
          : null
        target =
          current && sectionContains(current)
            ? current
            : sections.find(sectionContains) ?? null
      }
      if (target === null) {
        toast('error', t('sections.inspector.noCrossSectionForContact'))
        return
      }
      if (target.id !== selectedSectionId) {
        setSelectedSectionId(target.id)
        setSelectedId(null)
        setSelectedBoreholeId(null)
      }
      setFocusedContactIds(contactIds)
      if (focusedContactsTimeoutRef.current !== null) {
        window.clearTimeout(focusedContactsTimeoutRef.current)
      }
      focusedContactsTimeoutRef.current = window.setTimeout(() => {
        setFocusedContactIds([])
        focusedContactsTimeoutRef.current = null
      }, 2500)
    },
    [contacts, lithoContacts, sectionModelAxis, boreholes, cpts, sections, selectedSectionId, setSelectedId, setSelectedBoreholeId],
  )

  const clearSectionSelection = useCallback(() => {
    setSelectedSectionId(null)
  }, [])

  // ---------------------------------------------------------------------------
  // Tie-section suggestion handlers (Task 4).
  // Ghost-display candidates proposed by suggestTieSections; accepted via
  // handleAcceptTie which creates a real section by the same POST path as
  // handleSectionLineDrawn.
  // ---------------------------------------------------------------------------

  const handleSuggestTies = useCallback(
    (cpts: TieInvestigation[], boreholes: TieInvestigation[]) => {
      if (!project) return
      const tol = readSectionDefaults(project.view_state ?? null).tieStrikeToleranceM
      const parallels = visibleSections.map(s => ({
        id: s.id,
        start_x: s.start_x,
        start_y: s.start_y,
        end_x: s.end_x,
        end_y: s.end_y,
        projection_buffer_m: s.projection_buffer_m,
        excluded_cpt_ids: s.excluded_cpt_ids ?? [],
        excluded_borehole_ids: s.excluded_borehole_ids ?? [],
      }))
      const ties = suggestTieSections(parallels, cpts, boreholes, tol)
      setSuggestedTies(ties)
      if (ties.length === 0) {
        toast('warning', t('sections.toast.noCleanTies'))
      } else {
        log.info('section', `proposed ${ties.length} tie-section(s)`)
      }
    },
    [project, visibleSections],
  )

  const handleRejectTie = useCallback((index: number) => {
    setSuggestedTies(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handleClearTieSuggestions = useCallback(() => setSuggestedTies([]), [])

  const handleAcceptTie = useCallback(
    async (index: number) => {
      if (!project) return
      const epsg = effectiveHorizontalEpsg
      if (epsg == null) return
      const tie = suggestedTies[index]
      if (!tie) return
      // WHY visibleSections, not sections: same reason as handleSectionLineDrawn —
      // the manifest-gated count reflects what the user sees, not raw DB rows.
      const ordinal = visibleSections.length + 1
      const createPayload = tieToCreatePayload(
        tie,
        ordinal,
        epsg,
        readSectionDefaults(project.view_state ?? null).verticalExaggeration,
      )
      try {
        // No undo push (unlike handleSectionLineDrawn): an accepted tie is removed
        // from the ghost list on success; re-running Suggest re-proposes it, and the
        // created section is reversible via the normal delete-section path.
        const created = await api.section.create(project.id, createPayload)
        setSections(prev => [...prev, created])
        handleSectionCreated(created.id)
        // Do NOT select the new section: selecting flips SectionsCanvas to its
        // profile view, throwing the user off the map mid-triage. Stay on the
        // map so they can keep accepting/rejecting the remaining ghosts; the new
        // tie line just appears there. (Matches handleAcceptAllTies.)
        setSuggestedTies(prev => prev.filter((_, i) => i !== index))
        log.success('section', `accepted tie ${created.name}`)
      } catch (err) {
        log.error('section', 'accept-tie failed', err)
        toast('error', t('sections.toast.tieCreateFailed'))
      }
    },
    [project, effectiveHorizontalEpsg, suggestedTies, visibleSections.length, handleSectionCreated],
  )

  const handleAcceptAllTies = useCallback(async () => {
    if (!project) return
    const epsg = effectiveHorizontalEpsg
    if (epsg == null) return
    const ties = suggestedTies
    if (ties.length === 0) return
    const vexag = readSectionDefaults(project.view_state ?? null).verticalExaggeration
    const baseOrdinal = visibleSections.length
    const payloads = ties.map((tie, i) =>
      tieToCreatePayload(tie, baseOrdinal + i + 1, epsg, vexag),
    )
    try {
      const { sections: created } = await api.section.createBatch(project.id, { sections: payloads })
      setSections(prev => [...prev, ...created])
      created.forEach(s => handleSectionCreated(s.id))
      // Do NOT select a created section: selecting flips SectionsCanvas from the
      // map to a single section's profile view, yanking the user off the map
      // where they just accepted the whole ladder. Stay on the map — the new
      // tie-section lines simply appear there.
      setSuggestedTies([])
      log.success('section', `accepted all ${created.length} tie-section(s)`)
    } catch (err) {
      log.error('section', 'accept-all-ties failed', err)
      toast('error', t('sections.toast.tiesCreateFailed'))
    }
  }, [project, effectiveHorizontalEpsg, suggestedTies, visibleSections.length, handleSectionCreated])

  // P2-G / P2-H: apply a server-returned updated section to local state
  // without a round-trip GET.  Replaces the matching entry in the sections
  // list by id.  Used by the Seed handler (updated_section from the auto-
  // populate response) and the manual-draw handler (GET response after the
  // section-seeding PATCH).  No-op when the id is not found (defensive).
  const applyUpdatedSection = useCallback((updated: CrossSectionResponse) => {
    setSections(prev => prev.map(s => (s.id === updated.id ? updated : s)))
    log.debug('section', `applyUpdatedSection: ${updated.id} seeded set updated`)
  }, [])

  return {
    sections,
    selectedSectionId,
    drawingSection,
    focusedContactIds,
    visibleSections,
    effectiveHorizontalEpsg,
    sectionModelAxis,
    setSectionModelAxis,
    backdropModelIdOverride,
    setBackdropModelIdOverride,
    refreshSectionList,
    clearSectionSelection,
    handleSectionCreated,
    handleSectionDeleted,
    handleCreateSection,
    cancelSectionDraw,
    handleSectionLineDrawn,
    handleDeleteSection,
    handlePatchSelectedSection,
    handleSelectSection,
    handleFocusContacts,
    applyUpdatedSection,
    sectionFocusedColumn,
    setSectionFocusedColumn,
    correlateMode,
    correlationSource,
    enterCorrelateMode,
    exitCorrelateMode,
    armCorrelationSource,
    clearCorrelationSource,
    suggestedTies,
    handleSuggestTies,
    handleAcceptTie,
    handleAcceptAllTies,
    handleRejectTie,
    handleClearTieSuggestions,
  }
}
