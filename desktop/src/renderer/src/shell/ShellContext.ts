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
import type { UseBedOverridesResult } from '../hooks/useBedOverrides'
import type { UseMapOverlaysResult } from '../hooks/useMapOverlays'
import type { UseProjectLifecycleResult } from '../hooks/useProjectLifecycle'
import type { UseInvestigationDataResult } from '../hooks/useInvestigationData'
import type { UseUndoStackResult } from '../hooks/useUndoStack'
import type { UseMapStateResult } from '../hooks/useMapState'
import type { SectionModelAxis } from '../hooks/useSections'
import type { CptListItem, BoreholeListItem, ProjectResponse } from '../api/client'

/** The five node kinds a Parameters scope can be (spec §2, 2026-08-27). */
export type ParameterUnitScopeKind =
  | 'litho-unit'
  | 'litho-body'
  | 'geotech-class'
  | 'geotech-body'
  | 'geotech-group'
  | 'geotech-unit'

/**
 * The unit the Parameters stage is scoped to — a node in the owner-ruled
 * body tree (spec §2, 2026-08-27, variant B).
 *
 * A six-kind discriminated union: four tree nodes, one jump-only fallback, and
 * one CANVAS-DERIVED aggregate (``geotech-group``). The kind is load-bearing on
 * two axes:
 *
 * * WHICH MODEL to read (owner ruling R1): a ``litho-*`` scope pools the litho
 *   model — the whole litho unit / body, spanning every NAD subdivision — while
 *   a ``geotech-*`` scope pools the geotech model. Resolving a litho id against
 *   the geotech roster is exactly the silent-empty-statistics bug this type
 *   makes unrepresentable.
 * * WHICH GROUND inside the model (owner body-scope ruling, verbatim: *"a body
 *   is only a body if it is geometrically connected or if the users says, this
 *   body is the same as that body"*): a unit lumps many resolver bodies, a
 *   body narrows to one, and a class row sits between the litho body and its
 *   geotech bodies (the tree's third level).
 *
 * ``bandsForScope`` in ``parameterBodyTree.ts`` is the single authority that
 * maps any of these to its band set — every consumer (statistics, populations,
 * OKP/PSD, the cutout body set, the counts) goes through it, never a
 * consumer-local branch on the kind.
 */
export type ParameterUnitScope =
  | { kind: 'litho-unit'; unitId: string }
  | { kind: 'litho-body'; unitId: string; bodyId: string }
  | { kind: 'geotech-class'; lithoUnitId: string; lithoBodyId: string; nadClass: number }
  | { kind: 'geotech-body'; unitId: string; bodyId: string }
  // The manual-group aggregate (D2): not a tree node of its own and never on the
  // deep-link bus, but it IS a selection — the unit-list pane picks it when a
  // row that stands for a grouped body is clicked (owner 2026-09-11: "show the
  // whole group together in the parameter pane"), and the canvas still DERIVES
  // it for a deep-link-arrived ``geotech-body``. Either way it pools every
  // member's bands.
  | { kind: 'geotech-group'; unitId: string; groupNumber: number; memberBodyIds: readonly string[] }
  | { kind: 'geotech-unit'; unitId: string }

/**
 * Which model axis a scope reads — the ONE branch consumers still need before
 * they reach ``bandsForScope`` (they pick the litho or geotech layer list /
 * active model from it). ``'litho'`` for ``litho-unit`` / ``litho-body``;
 * ``'geotech'`` for every geotech kind (class / body / group / unit).
 *
 * @param scope  Any scope in the union.
 * @returns  ``'litho'`` or ``'geotech'``.
 */
export function parameterScopeModel(scope: ParameterUnitScope): 'litho' | 'geotech' {
  return scope.kind === 'litho-unit' || scope.kind === 'litho-body' ? 'litho' : 'geotech'
}

/** The Parameters stage's canvas tabs. */
export type ParametersTabId = 'per-test' | 'per-unit' | 'methods'

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
  /**
   * Select a CPT WITHOUT touching the Data stage's view mode.
   *
   * Same selection + detail/plot warming as ``handleSelect``, minus the
   * ``setView('chart')``. Stages other than Data select a CPT to render it in
   * their OWN surface (Parameters plots it in the inspector); firing the
   * Data-stage view switch there silently rewrites where Data lands the next
   * time the engineer goes back to it — a side effect he never asked for and
   * cannot see happen.
   */
  handleSelectWithoutView: (id: string) => Promise<void>
  /** Select a borehole: sets selectedBoreholeId, clears CPT + section, loads detail, switches to chart. */
  handleSelectBorehole: (id: string) => Promise<void>
  /** Export the section's geological model to DXF (owns the save-dialog + file-write flow). */
  handleExportSectionDxf: (
    projectId: string,
    sectionId: string,
    sectionName: string,
    modelId: string,
  ) => Promise<void>
  /** Export the section's geological model as a Plaxis 2D plxscripting
   *  script (debt #29 — owns the same save-dialog + file-write flow). */
  handleExportSectionPlaxis2d: (
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
  /**
   * Geology-stage deep-link request — set by the Sections canvas (litho
   * axis) when the user picks "Edit in Geology stage" from a geological
   * contact's context menu.
   *
   * ``AppShell`` watches this value and, when non-null, calls
   * ``setActiveStage('geology')`` + selects the given section so the
   * Geology stage opens on the right section with the contact selected
   * for immediate editing.  The payload is cleared after the navigation
   * applies (single-fire — subsequent re-mounts of the Geology inspector
   * do not re-apply a stale target).
   *
   * Lives in Coordinator (not sections or geoModel) because it spans
   * three hook boundaries: written by the Sections canvas, consumed by
   * AppShell for the stage switch, and consumed by GeologyInspector for
   * the per-contact focus — the same cross-boundary rationale as
   * ``sessionImportSectionIds``.
   */
  geoDeepLinkTarget: { sectionId: string; contactId: string } | null
  /** Set or clear the geology deep-link target. */
  setGeoDeepLinkTarget: (
    target: { sectionId: string; contactId: string } | null,
  ) => void
  /**
   * Sections deep-link request — set by the surface-crossings banner (in
   * either the Geology or Sections inspector) when the user picks an
   * issue.  AppShell watches this, switches to the Sections stage,
   * selects the chosen section, and triggers the focus-contacts pulse so
   * the section view pans + amber-pulses the offending columns.  The
   * payload is cleared after dispatch (single-fire — subsequent inspector
   * re-mounts do not re-apply a stale target).
   *
   * Same architectural rationale as ``geoDeepLinkTarget``: the writer
   * (inspector) and the consumer (AppShell + sections hook) live in
   * different React subtrees, and the dispatch must survive the stage
   * transition.
   */
  sectionsDeepLinkTarget: {
    sectionId: string
    contactIds: readonly string[]
    /** Axis the destination must select before opening this section. */
    sectionModelAxis?: SectionModelAxis
    /**
     * Investigations whose COLUMNS to bring on screen once the section is open.
     *
     * ONE id is the Build pre-flight's "go to that test through one click"
     * (owner ruling 2026-08-26): centre that column and pulse it.
     *
     * TWO ids name a GAP by the columns it stands between — the gapless build
     * report's "Show me" (owner dogfeed 2026-08-28: *"the show me button opens
     * section but doesn't zoom to issue"*). The section panel centres on the
     * midpoint of their span, which IS the gap. Names travel, never a gap
     * index: an index is only valid on the litho frame's column list, and on
     * the geotech axis's own ``visibleColumns`` it is a different gap.
     *
     * It rides the SAME payload as the contact deep-link because it wants the
     * same three steps: switch stage, select section, act once the panel has
     * had a beat to fetch. A caller sets one or the other, never both:
     * ``contactIds`` is empty here, and ``handleFocusContacts`` no-ops on an
     * empty list, so the two paths cannot fight over the camera.
     */
    revealInvestigationIds?: readonly string[]
  } | null
  /** Set or clear the sections deep-link target. */
  setSectionsDeepLinkTarget: (
    target: {
      sectionId: string
      contactIds: readonly string[]
      sectionModelAxis?: SectionModelAxis
      revealInvestigationIds?: readonly string[]
    } | null,
  ) => void
  /**
   * Parameters-stage deep-link request — set when the engineer picks "Unit
   * statistics…" from a right-click menu in a cross-section (owner ballot
   * 2026-08-26, the layer → parameters jump; extended 2026-08-27 to litho
   * units and fill regions).
   *
   * ``AppShell`` watches it, switches to the Parameters stage and writes
   * ``selectedParameterUnit`` so the stage opens already scoped to the
   * clicked unit. Cleared on dispatch (single-fire), like its two siblings.
   *
   * Unlike ``sectionsDeepLinkTarget`` this one clears SYNCHRONOUSLY: there is
   * no deferred camera work waiting on the payload, so the cleanup-before-
   * re-run hazard documented on that effect cannot arise here.
   *
   * Same cross-boundary rationale as ``geoDeepLinkTarget``: the writer (a
   * section overlay) and the consumers (AppShell + the Parameters stage) live
   * in different React subtrees, and the request must survive the stage
   * transition.
   */
  parametersDeepLinkTarget: ParameterUnitScope | null
  /** Set or clear the parameters deep-link target. */
  setParametersDeepLinkTarget: (target: ParameterUnitScope | null) => void
  /**
   * The unit (litho or geotech — see {@link ParameterUnitScope}) whose
   * statistics the Parameters stage is scoped to, or ``null`` when none is
   * chosen.
   *
   * Lives in Coordinator rather than inside the Parameters stage because the
   * stage's inspector (the unit list, which writes it on a row click) and its
   * canvas (which draws the distributions — the R3 layout flip) are mounted
   * as SEPARATE ``StageDescriptor`` slots taking no props — they can only
   * meet on the bus. The deep-link above writes it too, from a different
   * stage entirely.
   */
  selectedParameterUnit: ParameterUnitScope | null
  /** Select (or clear) the unit the Parameters stage is scoped to. */
  setSelectedParameterUnit: (scope: ParameterUnitScope | null) => void
  /**
   * Which tab the Parameters canvas is on.
   *
   * On the bus rather than canvas-local state because the R3 layout flip
   * splits one surface across the two stage slots: the canvas shows the
   * scoped unit's statistics, the INSPECTOR shows the unit list — but only
   * while the canvas is on the per-unit tab. The inspector cannot see canvas
   * state any other way (both slots take no props).
   */
  parametersActiveTab: ParametersTabId
  /** Switch the Parameters canvas tab. */
  setParametersActiveTab: (tab: ParametersTabId) => void
  /**
   * Flag the project as having unsaved MUTATIONS of pre-existing rows.
   *
   * ``projectDirty`` is ``metadataDirty || hasUnsavedMutations || the
   * session-import sets``. An edit that changes a row which never flowed
   * through the session-import manifest — a dragged contact depth, an
   * engineer-typed water table — contributes to none of those sets, so
   * without this call the title bar shows no unsaved marker, File → Save is
   * never prompted, and the next open of the .gmproj (which replace-restores
   * the DB from the file) silently drops the edit.
   *
   * Lives in Coordinator because App owns the flag and writers are spread
   * across hooks and stage inspectors alike.
   */
  markMutated: () => void
  /**
   * Monotonic nonce bumped after a successful auto-correlate (#163c).
   *
   * Written by ``handleAutoCorrelate`` (via the
   * ``requestCorrelationEdgesRefetch`` callback wired in App.tsx) and read
   * by ``SectionsCanvas``, which lists it in its contact-edge refetch
   * effect deps. A change forces the canvas to re-GET its correlation
   * edges so the overlay updates without a manual section reselect.
   *
   * Lives in Coordinator because it spans the toolbar/geoModel write path
   * and the SectionsCanvas read path — the same cross-boundary rationale
   * as ``geoDeepLinkTarget``.
   */
  correlationEdgesRefetchNonce: number
  /**
   * Body-identity recompute nonces (slice 5), one per model axis. Bumped (via
   * ``requestBodyRecompute``) by every mutation that can move body geometry —
   * tie create/delete/accept + their undo closures, edge-drag retargets, the
   * toolbar auto-correlate / accept-all verbs, the geotech packing verbs,
   * subdivide-cpts, section create/delete, litho layer accepts, and
   * boundary-shape saves. Watched by ``useProjectBodyRecompute`` (mounted in
   * App, stage-independent), which schedules the debounced
   * ``bodies/recompute`` POST for the bumped axis's model and also owns the
   * once-per-project-open initial recompute.
   */
  bodyRecomputeLithoNonce: number
  bodyRecomputeGeotechNonce: number
  /** Bump the recompute nonce of the model axis a mutation changed. */
  requestBodyRecompute: (kind: 'litho' | 'geotech') => void
  /**
   * Whether the Data-stage Import dropdown is open. Lives on the coordinator
   * because DataToolbar (the writer) and the guided tutorial (the reader, via
   * ``useTutorialState``) sit in different subtrees — the same cross-boundary
   * rationale as ``geoDeepLinkTarget``. It lets the "Open the Import menu" step
   * move on by itself when the menu opens (owner ruling 1, 2026-09-06).
   *
   * OPTIONAL so the many fully-typed ``ShellContextValue`` test fixtures need
   * not each add it; the real bus (``useShellContextValue``, fed from App) always
   * sets it, and the tutorial reads it as ``=== true``.
   */
  importMenuOpen?: boolean
  /** Set the Import-menu-open flag (DataToolbar reports its dropdown state). */
  setImportMenuOpen?: (open: boolean) => void
  /**
   * The draft horizontal CRS EPSG chosen in the OPEN project-settings dialog,
   * or null when the dialog is closed / no CRS has been drafted. Written by
   * ProjectMetadataDialog (through AppDialogs), read by the guided tutorial via
   * ``useTutorialState`` so the "Set the coordinate system" step advances the
   * moment a CRS is picked in the dialog, before Save (owner ruling 1,
   * 2026-09-06). Same writer-and-reader-in-different-subtrees rationale as
   * ``importMenuOpen``.
   *
   * OPTIONAL so the many fully-typed ``ShellContextValue`` test fixtures need
   * not each add it; the real bus (``useShellContextValue``, fed from App)
   * always sets it, and the tutorial reads it as ``!= null``.
   */
  metadataDraftHorizontalEpsg?: number | null
  /** The draft vertical datum EPSG chosen in the open dialog, same lifecycle. */
  metadataDraftVerticalEpsg?: number | null
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
  /** Project lifecycle — dirty flag, dialogs, save/close actions.
   *
   *  ``unsavedSummary`` and ``unsavedError`` are omitted on purpose: both
   *  exist to write the close-without-save dialog's body copy, which App
   *  renders directly via AppDialogs. No stage reads either, and carrying
   *  them here would oblige every stage test fixture to fabricate values it
   *  never uses. The force-revert prompt fields are omitted for the same
   *  reason — App renders that confirmation via AppDialogs, no stage reads it. */
  lifecycle: Omit<
    UseProjectLifecycleResult,
    | 'unsavedSummary'
    | 'unsavedError'
    | 'forceRevertPromptOpen'
    | 'forceRevertMessage'
    | 'handleForceRevertConfirm'
    | 'handleForceRevertSave'
    | 'handleForceRevertCancel'
  >
  /** CPT + borehole data, import flows, hide/restore, elevation edits.
   *
   *  The refresh-confirmation trio is omitted for the same reason as
   *  ``unsavedSummary`` above: it exists to drive an App-level dialog
   *  (``CptRefreshConfirmDialog``), no stage reads it, and carrying it here
   *  would oblige every stage test fixture to fabricate values it never uses. */
  investigations: Omit<
    UseInvestigationDataResult,
    'refreshConfirm' | 'confirmRefreshImport' | 'cancelRefreshImport'
  >
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
  /** Manual bed-level overrides — list, draw / form flow, CRUD (owner ruling
   *  2026-09-06). Optional so the many fully-typed ``ShellContextValue`` test
   *  fixtures need not each add it; the real bus (App via
   *  ``useShellContextValue``) always passes it. Consumers read defensively. */
  bedOverrides?: UseBedOverridesResult
  /** DEM hillshade + Virtuele Boring overlay state and handlers. */
  overlays: UseMapOverlaysResult
  /**
   * Toast notification stack and the ``toast`` action.
   *
   * ``dismissToast`` is omitted for the same reason as the lifecycle fields
   * above: the close button that calls it is rendered by AppDialogs, which
   * sits outside this context and reads the hook directly.
   */
  toasts: Omit<UseToastsResult, 'dismissToast'>
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
