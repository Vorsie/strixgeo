// Shell data bus — all hook results from App.tsx assembled into one context.
//
// §8 Risk 2 mitigation: the context value MUST be wrapped in ``useMemo``
// at the provider site (App.tsx). If assembled inline as an object literal,
// every App render recreates the object and every ``useShell()`` consumer
// re-renders — even when nothing in their slice changed. The ``useMemo``
// makes identity stable across renders where only unrelated state changed.
//
// Consumers call ``useShell()`` and destructure only the slice they need.
// The hook does NOT add a per-field selector abstraction — the cost of
// pulling in the full context value is a single ``useContext`` read, not a
// re-render, because React only re-renders when the context *value reference*
// changes (which the ``useMemo`` prevents unless something in the dep array
// actually changed).

import { createContext, useContext } from 'react'

import type { UseToastsResult } from '../hooks/useToasts'
import type { UseAppBootResult } from '../hooks/useAppBoot'
import type { UseGeologicalModelResult } from '../hooks/useGeologicalModel'
import type { UseSectionsResult } from '../hooks/useSections'
import type { UseMapOverlaysResult } from '../hooks/useMapOverlays'
import type { UseProjectLifecycleResult } from '../hooks/useProjectLifecycle'
import type { UseInvestigationDataResult } from '../hooks/useInvestigationData'
import type { UseUndoStackResult } from '../hooks/useUndoStack'
import type { UseMapStateResult } from '../hooks/useMapState'
import type { CptListItem, BoreholeListItem, ProjectResponse } from '../api/client'

/**
 * App-level cross-hook coordinator state.
 *
 * These values live in App.tsx rather than in a single hook because they
 * span multiple hook boundaries by design: ``selectedId`` is written by
 * ``useInvestigationData`` import handlers and read by ``useSections``
 * for mutual-exclusion; ``view`` is written by import handlers AND read
 * by the canvas switcher. Extracting them into a dedicated hook would
 * create a circular dependency between ``useInvestigationData`` and
 * ``useSections``. They are grouped here as a named slice so stage
 * components have a predictable, documented place to find them.
 *
 * See the coordinator comment block in App.tsx for the full rationale.
 */
export interface Coordinator {
  /** Currently selected CPT id, or ``null`` when nothing is selected. */
  selectedId: string | null
  /** Currently selected borehole id, or ``null`` when nothing is selected. */
  selectedBoreholeId: string | null
  /** Update the selected CPT id. */
  setSelectedId: (id: string | null) => void
  /** Update the selected borehole id. */
  setSelectedBoreholeId: (id: string | null) => void
  /** Current main canvas mode — map overview or detail chart. */
  view: 'map' | 'chart'
  /** Switch the main canvas mode. */
  setView: (v: 'map' | 'chart') => void
  /** Select a CPT: sets selectedId, clears borehole + section, loads detail, switches to chart. */
  handleSelect: (id: string) => Promise<void>
  /** Select a borehole: sets selectedBoreholeId, clears CPT + section, loads detail, switches to chart. */
  handleSelectBorehole: (id: string) => Promise<void>
  /** Export the section's geological model to DXF (owns the save-dialog + file-write flow). */
  handleExportSectionDxf: (
    projectId: string,
    sectionId: string,
    sectionName: string,
    modelId: string,
  ) => Promise<void>
  /** CPT ids that are outside the current map viewport. Empty before the map reports bounds. */
  outOfViewportCptIds: ReadonlySet<string>
  /** Borehole ids outside the current map viewport. */
  outOfViewportBoreholeIds: ReadonlySet<string>
  /** Absolute path of the open .gmproj file, or ``null`` if unsaved. */
  projectFilePath: string | null
  /** Formation ids currently in the project manifest (drives session-dirty detection). */
  manifestFormationIds: ReadonlySet<string>
  /**
   * CPT IDs imported in the current session but not yet saved to the .gmproj
   * bundle.  Drives per-row amber asterisks in the investigation list.
   *
   * Lives in Coordinator (not ``investigations`` or ``lifecycle``) because it
   * spans both: written by the import handlers + the save/discard flow in
   * ``useProjectLifecycle``, read by the ``DataInspector`` list rows. No
   * single hook owns it, so it sits in the App-level coordinator slice.
   */
  sessionImportCptIds: ReadonlySet<string>
  /**
   * Borehole IDs imported in the current session but not yet saved.
   * Same amber-asterisk driver as ``sessionImportCptIds``.
   */
  sessionImportBoreholeIds: ReadonlySet<string>
  /**
   * Cross-section IDs created in the current session but not yet saved.
   *
   * Drives the per-row amber asterisk in ``SectionsInspector``'s
   * ``SectionList``.  Wired in G3 (debt #25 resolution): when
   * Sidebar.tsx's section list is retired, this inspector becomes the
   * sole section-list surface and the unsaved marker must reach parity
   * with CPT/borehole rows.  Lives in Coordinator (not ``sections``)
   * for the same reason as ``sessionImportCptIds``: spans the
   * session-import state write path (``useSections``) and the read
   * path (``SectionsInspector``) across hook boundaries.
   */
  sessionImportSectionIds: ReadonlySet<string>
  /**
   * Formation IDs created in the current session but not yet saved.
   *
   * Drives the per-row amber asterisk in ``GeologyInspector``'s
   * formation list (wired in G4).  Same coordinator-bus rationale as
   * ``sessionImportSectionIds`` above.
   */
  sessionImportFormationIds: ReadonlySet<string>
  /**
   * Investigation IDs (CPT or borehole) currently selected by a map
   * marquee drag.  Drives the checkbox "checked" state in
   * ``DataInspector`` so the list and map selections stay in sync.
   *
   * Lives in Coordinator (not DataInspector local state) because the
   * map writes it and the inspector reads it — two separate components
   * that cannot share local state without the bus.
   */
  marqueeSelectedIds: ReadonlySet<string>
  /** Replace the marquee selection set (called by the map on drag-end). */
  setMarqueeSelectedIds: (ids: Set<string>) => void
  /**
   * Investigation id currently hovered in the Data inspector list.
   * MapView highlights the matching marker (if visible). ``null`` when
   * nothing is hovered.
   */
  hoveredTestId: string | null
  /** Set / clear the hovered investigation id (DataInspector row hover). */
  setHoveredTestId: (id: string | null) => void
}

/**
 * The full app state bus carried through the shell.
 *
 * Each field is the verbatim return value of the corresponding hook in
 * App.tsx.  Stage components read from this via ``useShell()`` rather than
 * receiving prop avalanches from the shell.
 *
 * ``project`` is lifted out of ``lifecycle`` for ergonomics — it is the
 * most-read field and saves a destructuring level for every consumer.
 */
export interface ShellContextValue {
  /** Active project (never null inside AppShell — the project gate in
   *  App.tsx ensures AppShell only mounts when a project is loaded). */
  project: ProjectResponse
  /** Project lifecycle — dirty flag, dialogs, save/close actions. */
  lifecycle: UseProjectLifecycleResult
  /** CPT + borehole data, import flows, hide/restore, elevation edits. */
  investigations: UseInvestigationDataResult
  /**
   * Manifest-filtered, removed-set-filtered CPT list.
   *
   * Computed in App.tsx and carried here so stage summary hooks and
   * stage components can read the user-visible list without re-computing
   * the two-layer filter.
   */
  visibleCpts: CptListItem[]
  /**
   * Manifest-filtered, removed-set-filtered borehole list.
   *
   * Same provenance as ``visibleCpts``.
   */
  visibleBoreholes: BoreholeListItem[]
  /** Geological model — formations, contacts, surfaces, all mutation handlers. */
  geoModel: UseGeologicalModelResult
  /** Cross-sections — list, selection, draw mode, CRUD. */
  sections: UseSectionsResult
  /** DEM hillshade + Virtuele Boring overlay state and handlers. */
  overlays: UseMapOverlaysResult
  /** Toast notification stack and ``toast`` action. */
  toasts: UseToastsResult
  /** Undo / redo stack — push + undo + redo + clear + canUndo + canRedo + busy. */
  undo: UseUndoStackResult
  /** API boot — ``ready`` and ``apiError`` (stable refs; rarely needed by stages). */
  boot: UseAppBootResult
  /**
   * Map layer-visibility, viewport bounds, and Leaflet camera persistence.
   *
   * The full ``useMapState()`` result is surfaced here so stage components
   * (e.g. DataStage's canvas) can read / write layer toggles without prop
   * drilling.  The individual stable callbacks inside this result are safe
   * to include in effect dep arrays; the object itself should NOT be placed
   * in a useEffect dep array because it is rebuilt each render.
   */
  mapState: UseMapStateResult
  /**
   * App-level cross-hook coordinator state — selection, view mode, and
   * DXF export.  See ``Coordinator`` above for the full rationale.
   */
  coordinator: Coordinator
}

/**
 * The shell data bus context.
 *
 * Initialised with ``null!`` so TypeScript narrows cleanly inside providers.
 * Consuming code outside a ``ShellContext.Provider`` will get a runtime error
 * (intentional — stage components must be rendered inside AppShell).
 */
export const ShellContext = createContext<ShellContextValue>(null!)

/**
 * Selector hook for the shell data bus.
 *
 * Stage components call ``useShell()`` and destructure the slice they need.
 * Must be called from within a component tree that has a
 * ``<ShellContext.Provider>`` ancestor (i.e. inside AppShell).
 *
 * Returns
 * -------
 * ShellContextValue
 *     The full assembled context value.
 *
 * Raises
 * ------
 * TypeError
 *     At runtime if called outside a ``ShellContext.Provider``.
 */
export function useShell(): ShellContextValue {
  return useContext(ShellContext)
}
