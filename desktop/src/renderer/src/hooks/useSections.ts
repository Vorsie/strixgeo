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

import { api } from '../api/client'
import type { CrossSectionResponse, FormationContactResponse } from '../api/client'
import { addAllToSet } from '../utils/sets'
import { projectPointOntoLine } from '../utils/sectionProjection'
import { wgs84ToProjected } from './useWgs84'
import { log } from '../utils/log'
import type { UndoCommand } from './useUndoStack'

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
  handleFocusContacts: (contactIds: readonly string[]) => void
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
  manifestSectionIds,
  addToManifest,
  removeFromManifest,
  setSessionImportSectionIds,
  contacts,
  boreholes,
  cpts,
  setSelectedId,
  setSelectedBoreholeId,
}: {
  project: { id: string; default_horizontal_epsg: number | null; name: string } | null
  /** From ``useAppBoot`` — data loading waits until the API is up. */
  ready: boolean
  toast: (type: 'success' | 'error', message: string) => void
  pushUndo: (cmd: UndoCommand) => void
  manifestSectionIds: ReadonlySet<string>
  addToManifest: (kind: 'section', ids: string[]) => void
  removeFromManifest: (kind: 'section', ids: Iterable<string>) => void
  setSessionImportSectionIds: (updater: (prev: Set<string>) => Set<string>) => void
  contacts: FormationContactResponse[]
  boreholes: readonly BoreholeAnchor[]
  cpts: readonly CptAnchor[]
  setSelectedId: (id: string | null) => void
  setSelectedBoreholeId: (id: string | null) => void
}): UseSectionsResult {
  const [sections, setSections] = useState<CrossSectionResponse[]>([])
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  // Two-click draw mode — active while the user is placing a section
  // line on the map. Set by handleCreateSection, cleared by
  // cancelSectionDraw and handleSectionLineDrawn.
  const [drawingSection, setDrawingSection] = useState(false)
  // Contact ids highlighted in the active cross-section. Driven by
  // clicks on the crossings banner (debt #9). Cleared after 2.5 s.
  const [focusedContactIds, setFocusedContactIds] = useState<readonly string[]>([])
  const focusedContactsTimeoutRef = useRef<number | null>(null)

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
      toast('error', 'Failed to load cross-sections.')
    }
  }, [project])

  // Auto-load sections whenever the API is ready and a project is open.
  // Mirrors the CPT/borehole auto-load in useInvestigationData so all
  // three lists refresh on project switch without App coordinating them.
  useEffect(() => {
    if (ready && project) {
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
  const visibleSections = sections.filter(s => manifestSectionIds.has(s.id))

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
      toast(
        'error',
        'No coordinate system found. Import investigations or set a ' +
          'Default horizontal CRS in Project metadata first.',
      )
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
        toast('error', 'The two endpoints landed at the same point. Try again.')
        return
      }
      const ordinal = sections.length + 1
      try {
        const createPayload = {
          name: `Cross-section ${ordinal}`,
          epsg,
          start_x: sx,
          start_y: sy,
          end_x: ex,
          end_y: ey,
        }
        const created = await api.section.create(project.id, createPayload)
        setSections(prev => [...prev, created])
        setSelectedSectionId(created.id)
        handleSectionCreated(created.id)
        log.success('section', `created ${created.name} from map draw`)
        const projectId = project.id
        let currentId = created.id
        pushUndo({
          description: 'Create cross-section',
          revert: async () => {
            await api.section.delete(projectId, currentId)
            setSections(prev => prev.filter(s => s.id !== currentId))
            setSelectedSectionId(prev => (prev === currentId ? null : prev))
          },
          reapply: async () => {
            const recreated = await api.section.create(projectId, createPayload)
            currentId = recreated.id
            setSections(prev => [...prev, recreated])
            setSelectedSectionId(recreated.id)
            handleSectionCreated(recreated.id)
          },
        })
      } catch (err) {
        log.error('section', 'create-from-draw failed', err)
        toast('error', 'Could not create the cross-section.')
      }
    },
    [project, effectiveHorizontalEpsg, sections.length, handleSectionCreated, pushUndo],
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
          },
          reapply: async () => {
            if (!currentId) return
            await api.section.delete(projectId, currentId)
            const deletedId = currentId
            setSections(prev => prev.filter(s => s.id !== deletedId))
            setSelectedSectionId(prev => (prev === deletedId ? null : prev))
            currentId = null
          },
        })
      } catch (err) {
        log.error('section', `delete ${id} failed`, err)
        toast('error', 'Could not delete the cross-section.')
      }
    },
    [
      project,
      selectedSectionId,
      handleSectionDeleted,
      handleSectionCreated,
      sections,
      pushUndo,
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
        toast('error', 'Could not save the section change.')
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
    (contactIds: readonly string[]) => {
      if (contactIds.length === 0) return
      const offending = contacts.filter(c => contactIds.includes(c.id))
      if (offending.length === 0) {
        toast('error', "Couldn't find the contact in the current project.")
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
      // Prefer the section the user is already viewing so the viewport
      // stays stable when the offending contact is already in sight.
      const current = selectedSectionId
        ? sections.find(s => s.id === selectedSectionId) ?? null
        : null
      const target =
        current && sectionContains(current)
          ? current
          : sections.find(sectionContains) ?? null
      if (target === null) {
        toast(
          'error',
          'No cross-section contains the offending contact — draw one through the borehole or CPT to view it.',
        )
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
    [contacts, boreholes, cpts, sections, selectedSectionId, setSelectedId, setSelectedBoreholeId],
  )

  const clearSectionSelection = useCallback(() => {
    setSelectedSectionId(null)
  }, [])

  return {
    sections,
    selectedSectionId,
    drawingSection,
    focusedContactIds,
    visibleSections,
    effectiveHorizontalEpsg,
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
  }
}
