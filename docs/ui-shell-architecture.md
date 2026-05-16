# UI Shell Architecture — Workflow-Spine Redesign

**Status:** Design document — pre-implementation. No code exists yet.
**Scope:** Shell skeleton + Sections stage only. Other four stages at contract level.
**Date:** 2026-05-15
**Trigger:** Debt #12 (App.tsx god-component) + Debt #14 (Sidebar overhaul) combined with the Phase 4 MVP gate forcing a cross-section editing surface that needs a real shell.

---

## 1. What we are deciding

The current shell is a capability-tab layout: Sidebar with Tests / Visualisation / Interpretation tabs drives a main canvas that switches between MapView, CptChart, BoreholeLog, and SectionPanel. The Toolbar is a single global import dropdown. There is no concept of "where in the workflow am I?" and no right-side inspector.

We are replacing this with a **workflow-spine shell** whose left rail is the engineering process in order (Data → Sections → Geology → Geotechnical → Export), whose center is the full-bleed canvas, whose right side is a contextual inspector, and whose top toolbar shows only the current stage's verbs.

This document specifies:

1. The target component tree and where each piece lives.
2. The App.tsx decomposition — state clusters mapped to custom hooks.
3. The stage-skeleton interface that proves the pattern generalises.
4. Where every existing component lands in the new shell.
5. The dark-first token foundation.
6. A phased build order with risk flags.
7. Risks and explicit non-goals.

---

## 2. Target shell component tree

### 2.1 File layout

All new shell code lives under `desktop/src/renderer/src/shell/`. Existing `components/` remain in place — the shell is a new container layer, not a rewrite of the components inside it.

```
renderer/src/
├── shell/
│   ├── AppShell.tsx            Root layout — replaces the render block in App.tsx.
│   │                           Composes StageSpine + StageToolbar + StageCanvas + Inspector.
│   ├── StageSpine.tsx          Left rail: stage buttons + per-stage state summary badges.
│   ├── StageToolbar.tsx        Top bar: stage-provided verb buttons + global controls
│   │                           (save state, dirty indicator, theme toggle).
│   ├── Inspector.tsx           Right rail: 420 px fixed, push-mode, non-modal.
│   │                           Renders stage.inspectorContent(context).
│   ├── StageCanvas.tsx         Center flex-fill: renders stage.canvasComponent(context).
│   │                           Owns the SectionScrubBar at the bottom.
│   ├── StageRegistry.ts        Maps StageId → StageDescriptor. Import all five descriptors
│   │                           here; AppShell reads from this map.
│   ├── StageContext.ts         React context carrying the active StageId + dispatch.
│   │                           Consumed by StageSpine buttons and any stage that needs
│   │                           to programmatically advance (e.g. "Go to Sections" from Data).
│   ├── useShellState.ts        Single hook: owns activeStageId + inspectorOpen. Persists
│   │                           activeStageId to localStorage (UI chrome, not bundle).
│   │                           inspectorOpen defaults true; user can collapse.
│   └── stages/
│       ├── data/
│       │   ├── DataStage.ts    StageDescriptor for the Data stage.
│       │   └── DataCanvas.tsx  Current Sidebar + map/chart/borelog area, refactored.
│       ├── sections/
│       │   ├── SectionsStage.ts       StageDescriptor — fully specified below.
│       │   ├── SectionsCanvas.tsx     Replaces the current selectedSection branch.
│       │   ├── SectionsToolbar.tsx    Section-specific verbs: New, Delete, Export DXF,
│       │   │                          Export Plaxis, Build Model, Auto-populate.
│       │   └── SectionsInspector.tsx  Section properties + formation list + crossings banner.
│       ├── geology/
│       │   └── GeologyStage.ts   Contract-only stub — Phase 4 follow-on.
│       ├── geotechnical/
│       │   └── GeotechnicalStage.ts   Contract-only stub — Phase 5.
│       └── export/
│           └── ExportStage.ts    Contract-only stub — Phase 4 follow-on.
```

### 2.2 AppShell layout

The rendered DOM shape:

```
<div class="flex flex-col h-screen bg-[--surface-app] overflow-hidden">

  <!-- Top bar -->
  <StageToolbar />          <!-- h-10, flex, items-center -->

  <!-- Body row -->
  <div class="flex flex-1 overflow-hidden">

    <!-- Left spine -->
    <StageSpine />          <!-- w-16, flex-col, border-r -->

    <!-- Center canvas -->
    <StageCanvas />         <!-- flex-1, overflow-hidden -->

    <!-- Right inspector (collapsible) -->
    <Inspector />           <!-- w-[420px], border-l, overflow-y-auto -->

  </div>

</div>
```

`StageSpine` is 64 px wide — icon + abbreviated label only. No text overflow. The stage summary badge (e.g. "3 formations · surfaces stale") appears as a compact dot badge on the spine icon, not a text label — text lives in the inspector header.

### 2.3 Stage selection drives three zones simultaneously

When the user clicks a spine button:

1. `useShellState` updates `activeStageId` → persisted to localStorage.
2. `StageCanvas` unmounts the previous canvas and mounts the new stage's `canvasComponent`.
3. `StageToolbar` renders the new stage's `toolbarVerbs`.
4. `Inspector` renders the new stage's `inspectorContent`.

No global re-render of siblings — each zone reads `activeStageId` from `StageContext` and renders independently. The spine itself never unmounts.

### 2.4 Stage state model and persistence

Two categories of state, with different persistence homes:

**UI chrome — localStorage only**

| Item | Key | Rationale |
|---|---|---|
| Active stage id | `groundmodel.shell.stage` | Per-user preference, not a project decision |
| Inspector open/collapsed | `groundmodel.shell.inspector_open` | Per-user preference |
| Sidebar sort order | `groundmodel.sidebar.sort` (existing) | Per-user preference |
| Per-pane Virtuele Boring visibility | existing keys | Per-user, already localStorage |

**Project decisions — view_state in .gmproj bundle**

| Item | Key in view_state | Rationale |
|---|---|---|
| Selected section id | `active_section_id` | Reopening a project should restore the section view |
| DEM overlay settings | `dem_overlay` (existing) | Per-project decision |
| Virtuele Boring overlay | `virtuele_boring` (existing) | Per-project decision |

The selected CPT / borehole id is NOT persisted — it is session-ephemeral (ux.md: "Open via single-click of the source item"). Restoring on reopen would require lazy-loading the chart data before showing anything, which adds latency to every project open.

**The active stage itself is localStorage, not view_state.** The user's mental model of "I was on the Sections stage" is a UI preference, not a project fact. Two engineers opening the same .gmproj may reasonably want to start on different stages.

---

## 3. App.tsx decomposition map

The current App.tsx is approximately 3,200 lines. Reading the file reveals nine distinct state clusters. Each maps to a custom hook; App.tsx becomes a thin coordinator that (a) calls all hooks, (b) renders AppShell, and (c) wires the Electron menu IPC subscriptions.

### 3.1 State cluster inventory

| Cluster | Current state variables | Current effects | Target hook |
|---|---|---|---|
| **Boot** | `ready`, `apiError` | boot effect (getApiBaseUrl + waitForApi) | `useAppBoot` |
| **Project lifecycle** | `project`, `savedProject`, `metadataDirty`, `projectFilePath`, manifest ids, `newProjectOpen`, `metadataEditorOpen`, `closeConfirmOpen`, `unsavedDialogOpen`, `unsavedSaving`, `unsavedDialogMode` | window title, quit handshake, menu IPC (New/Open/Save/Close/Recent) | `useProjectLifecycle` (extends debt #12 sketch) |
| **Investigation data** | `cpts`, `boreholes`, `selectedId`, `selectedBoreholeId`, `detailMap`, `plotMap`, `boreholeDetailMap`, `view`, `importing`, `bboxImportType`, `dovImporting`, `removedCptIds`, `removedBoreholeIds`, `sessionImportCptIds`, `sessionImportBoreholeIds`, `hiddenCptTypes`, `boreholeAxis`, `hiddenBoreholeValues`, `viewportBounds`, `mapCameraRef` | review list load, menu import IPC | `useInvestigationData` |
| **Geological model** | `activeGeologicalModel`, `formations`, `formationsRefreshCounter`, `contacts`, `surfacesByFormationId`, `crossingsRefreshCounter`, `lastSurfaceRefetchContactsRef`, `sessionImportFormationIds`, `sessionImportContactIds` | model bootstrap, auto-refetch surfaces on contact change | `useGeologicalModel` (extends debt #12 sketch) |
| **Cross-sections** | `sections`, `selectedSectionId`, `drawingSection`, `sessionImportSectionIds`, `focusedContactIds`, `focusedContactsTimeoutRef` | section list load | `useSections` |
| **DEM overlay** | `demSource`, `demOverlay` | none (memos only) | folds into `useMapOverlays` |
| **Virtuele Boring overlay** | `virtueleBoringOverlay`, `virtueleBoringSectionModels`, `cptVirtueleBoringOverride`, `boreholeVirtueleBoringOverride`, `virtueleBoringActiveModels`, `cptEffectiveModels`, `boreholeEffectiveModels`, `virtueleBoringPredictions`, `virtueleBoringLoading`, `virtueleBoringSkippedCount`, `virtueleBoringPredictionByInvestigationId`, `showOverlayOnSection`, `showOverlayOnCpt`, `showOverlayOnBorehole`, `projectIdForOverlay` | predictions fetch, pane seed from localStorage | `useMapOverlays` |
| **Undo stack** | none (delegated to useUndoStack) | keyboard listener, menu IPC | stays in App.tsx as-is — it's already a hook |
| **Toasts** | `toasts`, `toastId` | none | `useToasts` (tiny; extract so toast() is importable from hooks) |

### 3.2 Hook signatures (load-bearing extracts)

Only the signatures that shape how the coordinator wires things together. Internal implementation is for the build phase.

```typescript
// useAppBoot.ts
export function useAppBoot(): { ready: boolean; apiError: boolean }

// useToasts.ts
export function useToasts(): {
  toasts: Toast[]
  toast: (type: 'success' | 'error', message: string) => void
}

// useProjectLifecycle.ts — extends debt #12's useProjectLifecycle sketch
export function useProjectLifecycle(deps: {
  toast: (type: 'success' | 'error', message: string) => void
  geologicalModel: GeologicalModelResponse | null
  rebuildSurfaces: () => Promise<void>        // supplied by useGeologicalModel
}): {
  project: ProjectResponse | null
  savedProject: ProjectResponse | null
  metadataDirty: boolean
  projectFilePath: string | null
  manifestCptIds: ReadonlySet<string>
  manifestBoreholeIds: ReadonlySet<string>
  manifestFormationIds: ReadonlySet<string>
  manifestSectionIds: ReadonlySet<string>
  projectDirty: boolean
  sessionImports: {
    cptIds: ReadonlySet<string>
    boreholeIds: ReadonlySet<string>
    formationIds: ReadonlySet<string>
    sectionIds: ReadonlySet<string>
    contactIds: ReadonlySet<string>
  }
  // actions
  newProject: (opts: { name: string }) => Promise<ProjectResponse | null>
  openProjectFile: (path: string) => Promise<{ outcome: string } | null>
  pickAndOpenProject: () => Promise<{ outcome: string }>
  applyMetadataDraft: (patch: Partial<ProjectResponse>) => void
  applyViewStatePatch: (patch: Record<string, unknown>) => Promise<boolean>
  saveProject: () => Promise<boolean>
  saveAsProject: () => Promise<void>
  closeProject: () => void
  addToManifest: (kind: 'cpt' | 'borehole' | 'formation' | 'section', ids: string[]) => void
  removeFromManifest: (kind: 'cpt' | 'borehole' | 'formation' | 'section', ids: ReadonlySet<string>) => void
  addToSessionImports: (kind: 'cpt' | 'borehole' | 'formation' | 'section' | 'contact', ids: string[]) => void
  clearSessionImports: () => void
  discardSessionImports: (geologicalModel: GeologicalModelResponse | null) => void
  // dialog state (owned by the lifecycle, not by App)
  dialogs: {
    newProjectOpen: boolean
    setNewProjectOpen: (v: boolean) => void
    metadataEditorOpen: boolean
    setMetadataEditorOpen: (v: boolean) => void
    closeConfirmOpen: boolean
    setCloseConfirmOpen: (v: boolean) => void
    unsavedDialogOpen: boolean
    unsavedSaving: boolean
    unsavedDialogMode: 'close-project' | 'quit-app'
    handleUnsavedSave: () => Promise<void>
    handleUnsavedDiscard: () => void
    handleUnsavedCancel: () => void
    attemptClose: (source: 'sidebar' | 'menu') => void
  }
}

// useGeologicalModel.ts — extends debt #12 sketch
export function useGeologicalModel(deps: {
  project: ProjectResponse | null
  toast: (type: 'success' | 'error', message: string) => void
  pushUndo: (cmd: UndoCommand) => void
  addToManifest: (kind: 'formation', ids: string[]) => void
  removeFromManifest: (kind: 'formation', ids: ReadonlySet<string>) => void
  addToSessionImports: (kind: 'formation' | 'contact', ids: string[]) => void
}): {
  activeGeologicalModel: GeologicalModelResponse | null
  formations: GeologicalFormationResponse[]
  formationsRefreshCounter: number
  contacts: FormationContactResponse[]
  surfacesByFormationId: ReadonlyMap<string, FormationSurfaceResponse>
  crossingsRefreshCounter: number
  staleSurfaceCount: number
  // actions (contact CRUD, auto-populate, rebuild, exports, borehole toggle)
  handleFormationCreated: (id: string) => void
  handleFormationUpdated: () => void
  handleFormationDeleted: (id: string) => void
  handleCreateContact: (...) => Promise<void>
  handleUpdateContactDepth: (...) => Promise<void>
  handleBatchCreateContacts: (...) => Promise<void>
  handleBatchUpdateContacts: (...) => Promise<void>
  handleDeleteContact: (id: string) => Promise<void>
  handleAutoPopulateFromStratigraphy: (boreholeIds: readonly string[]) => Promise<void>
  handleDedupeContacts: () => Promise<number>
  handleRebuildSurfaces: () => Promise<void>      // also called by useProjectLifecycle on save
  handleExportModelPlaxis3d: () => Promise<void>
  handleInlineCreateFormation: (payload: GeologicalFormationCreatePayload) => Promise<{ id: string } | null>
  handleToggleBoreholeInModel: (boreholeId: string, included: boolean) => Promise<void>
  refetchFormations: () => void
}

// useSections.ts
export function useSections(deps: {
  project: ProjectResponse | null
  ready: boolean
  toast: (type: 'success' | 'error', message: string) => void
  pushUndo: (cmd: UndoCommand) => void
  addToManifest: (kind: 'section', ids: string[]) => void
  removeFromManifest: (kind: 'section', ids: ReadonlySet<string>) => void
  addToSessionImports: (kind: 'section', ids: string[]) => void
  contacts: FormationContactResponse[]
  cpts: CptListItem[]
  boreholes: BoreholeListItem[]
}): {
  sections: CrossSectionResponse[]
  visibleSections: CrossSectionResponse[]
  selectedSectionId: string | null
  selectedSection: CrossSectionResponse | null
  drawingSection: boolean
  focusedContactIds: readonly string[]
  handleSelectSection: (id: string) => void
  handleCreateSection: () => Promise<CrossSectionResponse | null>
  handleDeleteSection: (id: string) => Promise<void>
  handlePatchSelectedSection: (patch: SectionPatch) => Promise<void>
  handleSectionLineDrawn: (start: LatLng, end: LatLng) => Promise<void>
  cancelSectionDraw: () => void
  handleFocusContacts: (contactIds: readonly string[]) => void
  handleExportSectionDxf: (projectId: string, sectionId: string, sectionName: string, modelId: string) => Promise<void>
}

// useInvestigationData.ts
export function useInvestigationData(deps: {
  project: ProjectResponse | null
  ready: boolean
  toast: (type: 'success' | 'error', message: string) => void
  pushUndo: (cmd: UndoCommand) => void
  manifestCptIds: ReadonlySet<string>
  manifestBoreholeIds: ReadonlySet<string>
  addToManifest: (kind: 'cpt' | 'borehole', ids: string[]) => void
  addToSessionImports: (kind: 'cpt' | 'borehole', ids: string[]) => void
}): {
  cpts: CptListItem[]
  boreholes: BoreholeListItem[]
  visibleCpts: CptListItem[]
  visibleBoreholes: BoreholeListItem[]
  selectedId: string | null
  selectedBoreholeId: string | null
  view: 'map' | 'chart'
  importing: boolean
  dovImporting: boolean
  bboxImportType: 'cpt' | 'borehole' | null
  removedCptIds: ReadonlySet<string>
  removedBoreholeIds: ReadonlySet<string>
  detailMap: ReadonlyMap<string, CptResponse>
  plotMap: ReadonlyMap<string, CptPlotResponse>
  boreholeDetailMap: ReadonlyMap<string, BoreholeDetailResponse>
  hiddenCptTypes: ReadonlySet<string>
  boreholeAxis: BoreholeAxis
  hiddenBoreholeValues: Record<BoreholeAxis, ReadonlySet<string>>
  outOfViewportCptIds: ReadonlySet<string>
  outOfViewportBoreholeIds: ReadonlySet<string>
  viewportBounds: L.LatLngBounds | null
  mapCameraRef: React.RefObject<{ center: [number, number]; zoom: number } | null>
  setView: (v: 'map' | 'chart') => void
  setSelectedSectionId: (id: string | null) => void    // for mutual-exclusion wiring
  handleSelect: (id: string) => Promise<void>
  handleSelectBorehole: (id: string) => Promise<void>
  handleRemoveCpts: (ids: string[]) => void
  handleRemoveBoreholes: (ids: string[]) => void
  handleRestoreAllCpts: () => void
  handleRestoreAllBoreholes: () => void
  unhideCpts: (ids: Iterable<string>) => void
  unhideBoreholes: (ids: Iterable<string>) => void
  handleImportCpt: () => Promise<void>
  handleImportDov: () => void
  handleImportBoreholeDov: () => void
  handleBboxDrawn: (west: number, south: number, east: number, north: number) => Promise<void>
  handlePatchCptElevation: (id: string, elevationM: number | null, zEpsg: number | null) => Promise<void>
  handlePatchBoreholeElevation: (id: string, elevationM: number | null, zEpsg: number | null) => Promise<void>
  handleToggleCptType: (type: string, visible: boolean) => void
  handleToggleBoreholeValue: (value: string, visible: boolean) => void
  setBoreholeAxis: (axis: BoreholeAxis) => void
  handleViewportChange: (bounds: L.LatLngBounds) => void
  handleMapCameraChange: (center: [number, number], zoom: number) => void
}

// useMapOverlays.ts (DEM + Virtuele Boring merged — they share the same project.view_state dependency)
export function useMapOverlays(deps: {
  project: ProjectResponse | null
  applyViewStatePatch: (patch: Record<string, unknown>) => Promise<boolean>
  toast: (type: 'success' | 'error', message: string) => void
}): {
  demSource: DemSource | null
  demOverlay: DemOverlayState
  handleDemOverlayChange: (next: DemOverlayState) => Promise<void>
  virtueleBoringOverlay: VirtueleBoringOverlayState
  virtueleBoringSectionModels: readonly string[]
  virtueleBoringPredictions: VirtueleBoringInvestigationPrediction[]
  virtueleBoringLoading: boolean
  virtueleBoringSkippedCount: number
  virtueleBoringPredictionByInvestigationId: ReadonlyMap<string, VirtueleBoringInvestigationPrediction>
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
}
```

### 3.3 TDZ / hook-ordering hazards — what to watch

The debt #12 note on TDZ is the live risk for this refactor. Concrete things to watch:

**Hazard 1: `saveProject` depends on `handleRebuildSurfaces` from `useGeologicalModel`.**
Currently `saveProject` in App.tsx has a comment explaining it avoids calling `refetchSurfaces` directly because `refetchSurfaces` is declared further down the body. In the hook split, `useProjectLifecycle` receives `rebuildSurfaces` as a dependency injection parameter. This forward-reference becomes a constructor argument rather than a closure read — safe. The parameter must be declared before calling `useProjectLifecycle`.

**Hazard 2: `handleUpdateContactDepthRef` forward-ref pattern.**
`handleCreateContact` calls `handleUpdateContactDepthRef.current` to avoid a TDZ. In the hook, both functions are internal to `useGeologicalModel` so the ref pattern can be replaced with a direct internal reference (both are in the same module scope). Resolve this before extracting.

**Hazard 3: `handleBboxDrawn` closes over `bboxImportType`.**
After the hook split, `bboxImportType` and `setBboxImportType` live in `useInvestigationData`. `handleBboxDrawn` reads the current value — it must read from a ref if the callback is memoised, or use a setter-reads-prev pattern. Current code reads `bboxImportType` directly then immediately calls `setBboxImportType(null)` — this is fine in App.tsx but in a hook the stale-closure risk exists if the callback dep array omits `bboxImportType`. Keep the current pattern (include it in deps) or replace with a ref.

**Mitigation: smoke test must stay green at every commit.**
`App.smoke.test.tsx` mounts `<App />` with stubs and catches TDZ ReferenceErrors. After each hook extraction commit, run `npm test` before staging the next file. The smoke test is the canary; if it fails, stop and diagnose before proceeding.

### 3.4 What stays in App.tsx after the split

App.tsx becomes a thin coordinator. It:

1. Calls `useAppBoot()` — early returns for `apiError` / `!ready`.
2. Calls `useToasts()`.
3. Calls `useProjectLifecycle({ toast, geologicalModel, rebuildSurfaces })` — but `geologicalModel` and `rebuildSurfaces` come from `useGeologicalModel` which needs to be called first. The correct order:

```typescript
const { ready, apiError } = useAppBoot()
const { toast, toasts } = useToasts()
const { push: pushUndo, undo: doUndo, redo: doRedo, clear: clearUndo } = useUndoStack(...)
const geoModel = useGeologicalModel({ project: null, ... })  // project injected below via stable ref pattern
const lifecycle = useProjectLifecycle({ toast, geologicalModel: geoModel.activeGeologicalModel, rebuildSurfaces: geoModel.handleRebuildSurfaces })
// Now re-inject project into geoModel via a useEffect — or use a projectRef approach.
```

The cleaner solution is to pass `projectRef` (a React ref that useProjectLifecycle updates) instead of `project` directly. `useGeologicalModel` reads `projectRef.current` in its effects. This avoids the circular dependency and the need for `useEffect` plumbing between hooks. This is a common pattern when two hooks are tightly coupled.

4. Calls all other hooks with the project from lifecycle.
5. Renders `<AppShell>` with context providers for the hook returns.
6. Renders modal dialogs (NewProjectDialog, ProjectMetadataDialog, UnsavedChangesDialog, Modal close-confirm) — these stay at the App level because they overlay the entire shell.

Target App.tsx length after split: approximately 200–300 lines.

---

## 4. Stage-skeleton generalisation contract

### 4.1 The StageDescriptor interface

A stage is a plain TypeScript object implementing this interface. No class, no React component at the descriptor level — the descriptor is data that `AppShell` reads to configure its zones.

```typescript
// shell/StageDescriptor.ts

export type StageId = 'data' | 'sections' | 'geology' | 'geotechnical' | 'export'

export interface StageSummary {
  // Short text shown in the spine button tooltip and inspector header.
  label: string
  // Dot badge content on the spine icon. null = no badge.
  badge: string | null
  // Badge colour intent.
  badgeIntent?: 'neutral' | 'amber' | 'red'
}

export interface StageDescriptor {
  id: StageId
  // 24px Lucide icon component (not JSX — AppShell renders it with size={16}).
  icon: React.ComponentType<{ size?: number }>
  // Spine label (max ~10 chars — fits below the icon at w-16).
  spineLabel: string
  // Hook that computes the live summary badge from current app state.
  // Called inside AppShell (within React's render tree).
  useStageSummary: () => StageSummary
  // The canvas component for this stage. Receives the ShellContext via a hook.
  CanvasComponent: React.ComponentType
  // The top toolbar for this stage. Receives the ShellContext via a hook.
  ToolbarComponent: React.ComponentType
  // The right inspector for this stage. Receives the ShellContext via a hook.
  InspectorComponent: React.ComponentType
}
```

All three zone components (`CanvasComponent`, `ToolbarComponent`, `InspectorComponent`) consume shared state via hooks, not props. The shell does not pass a prop avalanche into each zone — it renders `<stage.CanvasComponent />` with no props, and the component hooks into the contexts it needs. This is the mechanism that keeps the skeleton general without prop-drilling.

### 4.2 ShellContext — the data bus

All hook results from App.tsx are bundled into a single context object. Stages consume the slice they need via a typed selector hook.

```typescript
// shell/ShellContext.ts

export interface ShellContextValue {
  project: ProjectResponse | null
  lifecycle: ReturnType<typeof useProjectLifecycle>
  investigations: ReturnType<typeof useInvestigationData>
  geoModel: ReturnType<typeof useGeologicalModel>
  sections: ReturnType<typeof useSections>
  overlays: ReturnType<typeof useMapOverlays>
  toasts: ReturnType<typeof useToasts>
  undo: { push: PushFn; undo: UndoFn; redo: RedoFn; clear: ClearFn }
}

export const ShellContext = createContext<ShellContextValue>(null!)

// Selector hook — components call useShell() not useContext(ShellContext).
export function useShell(): ShellContextValue {
  return useContext(ShellContext)
}
```

App.tsx assembles the context value from all hook returns and wraps `<AppShell>` in `<ShellContext.Provider value={...}>`.

### 4.3 Sections stage — fully worked example

`SectionsStage.ts`:

```typescript
import { FolderOpen } from 'lucide-react'
import { useShell } from '../ShellContext'
import SectionsCanvas from './SectionsCanvas'
import SectionsToolbar from './SectionsToolbar'
import SectionsInspector from './SectionsInspector'

const SectionsStage: StageDescriptor = {
  id: 'sections',
  icon: FolderOpen,
  spineLabel: 'Sections',
  useStageSummary: () => {
    const { sections, geoModel } = useShell()
    const count = sections.visibleSections.length
    const stale = geoModel.staleSurfaceCount
    const label = `${count} section${count !== 1 ? 's' : ''}`
    const badge = stale > 0 ? `${stale} stale` : count > 0 ? `${count}` : null
    const badgeIntent = stale > 0 ? 'amber' : 'neutral'
    return { label, badge, badgeIntent }
  },
  CanvasComponent: SectionsCanvas,
  ToolbarComponent: SectionsToolbar,
  InspectorComponent: SectionsInspector,
}

export default SectionsStage
```

`SectionsCanvas.tsx` contains what is currently the `selectedSection !== null` branch of App.tsx's render, plus the map shown when no section is selected. It reads from `useShell().sections` and `useShell().investigations` directly. `SectionPanel` slots in with zero prop changes — its existing props are now wired from the `useShell()` hook instead of being threaded down from App.tsx.

`SectionsToolbar.tsx` contains: New cross-section, Delete, Export DXF, Export Plaxis 3D, Build Model (with stale badge), Auto-populate from stratigraphy. These buttons existed scattered across Toolbar.tsx and InterpretationPane — they are now collected in one place for the Sections stage. The existing `Toolbar.tsx` global bar either survives as the project-lifecycle bar (Save, title, theme toggle) or is absorbed into `StageToolbar.tsx` — see section 4.4.

`SectionsInspector.tsx` contains: section name + endpoints display, projection buffer slider, vertical exaggeration slider, Virtuele Boring overlay controls, formation list (read-only ordered list of formations + staleness indicator), crossings banner. This is the material that currently lives in `InterpretationPane` minus the editing actions (those go to the toolbar).

### 4.4 Global controls in StageToolbar

`StageToolbar.tsx` has two zones:

- **Left zone**: renders `<stage.ToolbarComponent />` — stage-specific verbs.
- **Right zone**: always-visible global controls:
  - Dirty indicator (amber asterisk + project name) + Save button (Ctrl+S affordance).
  - Theme toggle (currently in Toolbar.tsx, moves here).
  - Close project X (currently in Sidebar header, moves here — consistent with Plaxis/Logic Pro "project in window title area").

This eliminates the current Toolbar.tsx import-dropdown-only design. The import actions move into the Data stage's toolbar.

### 4.5 Contract-level stubs for the other four stages

**Data stage.** Canvas = current map/chart/borelog layout, list management lifted from Sidebar. Toolbar = Import CPT, Import DOV (CPT + borehole), future DMT/monitoring imports. Inspector = current Sidebar's Tests/Visualisation tabs condensed: investigation list with sort/filter/multi-select. Summary badge = "N CPTs · M boreholes".

**Geology stage.** Canvas = map with formation-contact overlay (no cross-section strip — this is the 3D/plan view of the model). Toolbar = Build model, Auto-populate, Dedupe, Add formation, future G3Dv3 import trigger. Inspector = `InterpretationPane` contents (formation list, drag-reorder, crossings banner, Virtuele Boring overlay picker). Summary badge = "N formations · M contacts · X stale". This is Phase 4 follow-on work — the stage stub exists in the registry but renders a placeholder canvas until built.

**Geotechnical stage.** Canvas = cross-section or plan view with geotech-unit subdivision visible (debt #13). Toolbar = Add unit, Edit parameters (Phase 5). Inspector = unit list per formation, parameter values (Phase 5). Summary badge = "N units". Phase 5 work — stub only.

**Export stage.** *(Shipped 2026-05-16, debt #30.)* Canvas = the export hub: one actionable `ExportCard` per target (icon + description + action). DXF (section picker + Export) and Plaxis 3D (Export) ship today; Plaxis 2D / D-Stability / D-Sheet / GeoStudio / IFC / PDF report (debt #52) each land as one additional card — no toolbar/inspector change. Toolbar + Inspector = **null by design**: targets are picked on the canvas itself (the original "verbs in the toolbar" plan was superseded — the audit's agreed fix for debt #30 was canvas-based, and it keeps the export handlers shared verbatim with the Sections toolbar via the ShellContext bus). Summary badge = count of currently-runnable targets (`null` when nothing is exportable yet).

---

## 5. Where every existing component lands

| Component | Current location | Shell slot | Change required |
|---|---|---|---|
| `WelcomeScreen` | rendered by App.tsx before project loads | App.tsx pre-shell gate | None — not part of the shell |
| `NewProjectDialog` | App.tsx modal | App.tsx above AppShell | None |
| `ProjectMetadataDialog` | App.tsx modal | App.tsx above AppShell | None |
| `UnsavedChangesDialog` | App.tsx modal | App.tsx above AppShell | None |
| `Modal` (close confirm) | App.tsx modal | App.tsx above AppShell | None |
| `Toolbar` | App.tsx top bar | Replaced by `StageToolbar` | **Delete.** Import actions → DataStage toolbar. Theme toggle + save state → StageToolbar right zone. |
| `Sidebar` | App.tsx left column | Replaced by `StageSpine` + `DataStage` inspector | **Refactor.** CPT/borehole list → `DataStage`'s InspectorComponent. Interpretation/formation content → `GeologyStage` inspector. Section list → `SectionsStage` inspector. Spine itself is new. |
| `InterpretationPane` | Sidebar.tsx tab content | Split across `GeologyStage` toolbar (actions) + inspector (list) | **Refactor.** Extract action buttons to GeologyStage toolbar; keep list + formation row in GeologyStage inspector. |
| `MapView` | App.tsx center (map branch) | `DataStage` CanvasComponent | Wrap — pass props from `useShell()` instead of App.tsx |
| `CptChart` | App.tsx center (chart branch) | `DataStage` CanvasComponent | Wrap — same |
| `BoreholeLog` | App.tsx center (borehole branch) | `DataStage` CanvasComponent | Wrap — same |
| `SectionPanel` | App.tsx center (section branch) | `SectionsStage` CanvasComponent | **Wrap only** — SectionPanel's existing props wired from `useShell()`. Zero internal changes. |
| `BboxDrawer` | inside MapView | `DataStage` CanvasComponent → MapView | None |
| `SectionLineDrawer` | inside MapView | DataStage + SectionsStage trigger → MapView | None |
| `SectionScrubBar` | SectionPanel | `StageCanvas` bottom slot (always-on when section active) | Minor: lift out of SectionPanel into StageCanvas; keep SectionPanel owning the canvas content above the scrub. |
| `ElevationEditor` | CptChart, BoreholeLog headers | DataStage canvas components | None |
| `LabTestPanel` | used by BoreholeLog | DataStage canvas | None |
| `FormationPickerDialog` | SectionPanel | SectionsStage canvas | None |
| `FormationDialog` | InterpretationPane | GeologyStage inspector | None |
| `ContactsLayer` | SectionPanel internals | SectionsStage canvas | None |
| All `sections/` sub-components | SectionPanel internals | SectionsStage canvas | None |
| All `borelog/` sub-components | BoreholeLog internals | DataStage canvas | None |
| All `interpretation/` sub-components | InterpretationPane | GeologyStage inspector | Minor refactor to remove InterpretationPane wrapper if needed |
| All `ui/` primitives (Button, Modal, DirtyAsterisk) | global | global | None |

**Summary: zero existing leaf components need internal changes.** The refactor is purely about which wrapper renders them and how their props are sourced. The risk of breaking a component's internal behaviour is low.

---

## 6. Dark-first token foundation

### 6.1 Philosophy

The current app is light-first with `dark:` variants bolted on. The new shell is dark-first: the dark palette is the designed hero; light is an equal-quality alternate. This matches the brief ("dark surface is the designed hero") and is consistent with where geotech desktop software is going (Plaxis 3D is dark-by-default, Revit structural is moving dark).

WCAG 2.2 AA applies to both modes. Primer dark palette already clears 4.5:1 for body text on `--surface-page` — custom hues (soil patterns, formation colours, hash-derived marker colours) must be re-checked against dark backgrounds. This is a per-component verification step, not a blocking constraint.

### 6.2 Token structure in tailwind.config.js

We extend Tailwind's theme with semantic CSS custom properties. Components author against semantic tokens, never against raw palette steps. This ensures dark/light switching flips the token, not every class in every component.

```javascript
// tailwind.config.js — shape only, not the full file
module.exports = {
  darkMode: 'class',   // existing — keep
  theme: {
    extend: {
      colors: {
        // Surface hierarchy — maps onto Primer's two-level model
        'surface-app':    'var(--color-surface-app)',      // outermost shell background
        'surface-page':   'var(--color-surface-page)',     // content areas
        'surface-card':   'var(--color-surface-card)',     // cards, panels, inspector sections
        'surface-overlay':'var(--color-surface-overlay)',  // modals, dropdowns

        // Borders
        'border-subtle':  'var(--color-border-subtle)',    // section dividers, card edges
        'border-default': 'var(--color-border-default)',   // input rings, strong dividers

        // Text
        'text-primary':   'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-muted':     'var(--color-text-muted)',
        'text-on-accent': 'var(--color-text-on-accent)',   // text on blue/amber backgrounds

        // Accent — Primer: blue-600 light / blue-400 dark
        'accent':         'var(--color-accent)',
        'accent-muted':   'var(--color-accent-muted)',     // hover state of accent

        // Status — amber for dirty/stale, red for danger
        'status-amber':   'var(--color-status-amber)',     // DirtyAsterisk, stale badges
        'status-danger':  'var(--color-status-danger)',    // destructive actions

        // Spine — slightly elevated surface behind the stage spine buttons
        'spine-bg':       'var(--color-spine-bg)',
        'spine-active':   'var(--color-spine-active)',     // selected stage button fill
        'spine-hover':    'var(--color-spine-hover)',

        // Formation colours are NOT semantic tokens — they are dynamic
        // (hash-derived from formation name/id). Those stay in hashColor.ts.
      }
    }
  }
}
```

### 6.3 CSS custom properties in index.css

```css
/* index.css — token definitions */

:root {
  /* Light mode — DEFAULT palette (must be specified even if dark is the hero,
     because some users or contexts will use light) */
  --color-surface-app:      theme('colors.slate.100');
  --color-surface-page:     theme('colors.white');
  --color-surface-card:     theme('colors.slate.50');
  --color-surface-overlay:  theme('colors.white');
  --color-border-subtle:    theme('colors.slate.200');
  --color-border-default:   theme('colors.slate.300');
  --color-text-primary:     theme('colors.slate.900');
  --color-text-secondary:   theme('colors.slate.600');
  --color-text-muted:       theme('colors.slate.400');
  --color-text-on-accent:   theme('colors.white');
  --color-accent:           theme('colors.blue.600');
  --color-accent-muted:     theme('colors.blue.700');
  --color-status-amber:     theme('colors.amber.600');
  --color-status-danger:    theme('colors.red.600');
  --color-spine-bg:         theme('colors.slate.100');
  --color-spine-active:     theme('colors.blue.600');
  --color-spine-hover:      theme('colors.slate.200');
}

.dark {
  /* Dark mode — the designed hero palette */
  --color-surface-app:      theme('colors.slate.950');
  --color-surface-page:     theme('colors.slate.900');
  --color-surface-card:     theme('colors.slate.800');
  --color-surface-overlay:  theme('colors.slate.850');   /* custom step — add to Tailwind */
  --color-border-subtle:    theme('colors.slate.700');
  --color-border-default:   theme('colors.slate.600');
  --color-text-primary:     theme('colors.slate.50');
  --color-text-secondary:   theme('colors.slate.300');
  --color-text-muted:       theme('colors.slate.500');
  --color-text-on-accent:   theme('colors.white');
  --color-accent:           theme('colors.blue.400');
  --color-accent-muted:     theme('colors.blue.300');
  --color-status-amber:     theme('colors.amber.400');
  --color-status-danger:    theme('colors.red.400');
  --color-spine-bg:         theme('colors.slate.950');
  --color-spine-active:     theme('colors.blue.600');
  --color-spine-hover:      theme('colors.slate.800');
}
```

### 6.4 Authoring convention for new shell components

New shell components (`StageSpine`, `StageToolbar`, `Inspector`, `StageCanvas`) use ONLY semantic tokens — never raw `slate-800` or `blue-600` directly. Example:

```tsx
<div className="bg-surface-app border-r border-border-subtle text-text-secondary">
```

**Existing components** keep their current `dark:` variants for the initial shell build — migrating them to semantic tokens is a separate pass. The shell's own chrome (spine, toolbar, inspector frame) gets the semantic tokens from day one. This ensures the shell feels premium in dark mode immediately while the existing components catch up progressively.

### 6.5 Motion and depth budget

Apple HIG "Depth" for stage transitions. The spine selection change triggers a subtle cross-fade of the canvas and inspector content (150 ms ease-out opacity transition). The inspector's open/close is a 200 ms width transition. No slide-from-side animation for the canvas — geotech engineers switch stages frequently and animation budget should be minimal (< 250 ms for any stage transition). Respect `prefers-reduced-motion`: wrap all transition classes in a `motion-safe:` modifier.

---

## 7. Phased build order

The goal is a green test suite at every commit. One file per commit; Conventional Commits format.

### Phase S1 — Token foundation (safe to ship alone)

1. `chore(shell): add semantic color tokens to tailwind.config.js` — token names only, no component changes.
2. `chore(shell): add CSS custom property definitions to index.css` — dark hero palette, light fallback.
3. Smoke test check: `npm test` must pass. No component changes yet; only config files touched.

### Phase S2 — Extract hooks from App.tsx (highest TDZ risk)

Extract one cluster per commit. Sequence chosen to minimise forward-reference exposure:

1. `refactor(shell): extract useToasts from App.tsx`
2. `refactor(shell): extract useAppBoot from App.tsx`
3. `refactor(shell): extract useMapOverlays from App.tsx`
4. `refactor(shell): extract useGeologicalModel from App.tsx` — **RISK: handleUpdateContactDepthRef forward-ref; resolve the internal mutual-call with a module-level approach. Run smoke test before staging.**
5. `refactor(shell): extract useSections from App.tsx`
6. `refactor(shell): extract useInvestigationData from App.tsx`
7. `refactor(shell): extract useProjectLifecycle from App.tsx` — **RISK: saveProject depends on rebuildSurfaces. Use projectRef injection pattern. Smoke test is critical here.**
8. `refactor(shell): slim App.tsx to coordinator role`

After step 8, App.tsx should be ~200–300 lines. `App.smoke.test.tsx` and `App.hooks-order.test.ts` must both pass before any stage work begins.

### Phase S3 — Shell skeleton (pure addition)

All new files; no existing component changes:

1. `feat(shell): add StageDescriptor interface and StageRegistry`
2. `feat(shell): add ShellContext with useShell selector hook`
3. `feat(shell): add useShellState hook (activeStageId + inspectorOpen)`
4. `feat(shell): add StageSpine component with stage button layout`
5. `feat(shell): add StageToolbar component with left/right zones`
6. `feat(shell): add Inspector component (420 px, push-mode)`
7. `feat(shell): add StageCanvas component with SectionScrubBar slot`
8. `feat(shell): add AppShell component composing all zones`
9. `feat(shell): register AppShell in App.tsx behind project gate` — at this point the app renders the new shell with empty stage slots. Smoke test.

### Phase S4 — Data stage (migrates existing capability)

Wraps existing components into the Data stage; no behavioural changes:

1. `feat(shell): add DataStage descriptor with DataCanvas wrapper`
2. `feat(shell): add DataStage ToolbarComponent (import actions from Toolbar.tsx)`
3. `feat(shell): add DataStage InspectorComponent (investigation list from Sidebar tabs 1–2)`
4. `chore(shell): delete legacy Toolbar.tsx after DataStage toolbar covers all verbs`
5. `chore(shell): migrate Sidebar investigation-list sections to DataStage inspector`

### Phase S5 — Sections stage (the MVP deliverable of this design)

1. `feat(sections): add SectionsStage descriptor`
2. `feat(sections): add SectionsCanvas — wraps SectionPanel, adds map fallback when no section selected`
3. `feat(sections): add SectionsToolbar — New, Delete, Export DXF, Export Plaxis, Build, Auto-populate`
4. `feat(sections): add SectionsInspector — section properties, formation list, crossings banner, VB overlay`
5. `feat(sections): apply dark semantic tokens to all new Sections stage components`
6. `test(sections): add SectionsStage.test.tsx smoke render`
7. Dogfood on a real project. Adjust before moving to stubs.

### Phase S6 — Stub the remaining three stages

1. `feat(shell): add GeologyStage stub with placeholder canvas`
2. `feat(shell): add GeotechnicalStage stub`
3. `feat(shell): add ExportStage stub`

At this point the spine shows all five stages; three show "Coming soon" placeholders; the app is shippable for the Sections stage.

### S7 — Geology stage migration (Phase 4 follow-on, after Sections validates)

Move `InterpretationPane` content into GeologyStage inspector + toolbar. This is the point where debt #14 (Sidebar overhaul) is formally resolved.

---

## 8. Risks and explicit non-goals

### 8.1 Top 3 ways this goes wrong

**Risk 1 — TDZ regressions during hook extraction (HIGH probability, MEDIUM severity).**
The hook extraction in Phase S2 is the most dangerous step. App.tsx has documented TDZ hazards (the `handleUpdateContactDepthRef` forward-ref, the `saveProject` dependency on `refetchSurfaces`, the `bboxImportType` closure). Extracting 3,200 lines into eight hooks in sequence without introducing a TDZ requires verifying each extraction against the "const declared before first read" rule. The smoke test catches crash-shaped regressions but may miss subtle stale-closure bugs (state that reads an old value without throwing). Mitigation: run the full Vitest suite after every extraction commit; add a specific test for `saveProject` triggering the geological model rebuild before file write.

**Risk 2 — ShellContext value object identity causes excess re-renders (MEDIUM probability, MEDIUM severity).**
If the ShellContext value object is assembled inline in App.tsx's JSX (`value={{ lifecycle, investigations, ... }}`), every render of App.tsx recreates the object → every `useShell()` consumer re-renders. Mitigation: wrap the context value in `useMemo` with a dep array of all hook return objects. Each hook already returns stable references via useCallback/useMemo internally, so the context value object's identity only changes when something genuinely changes.

**Risk 3 — The spine stage model doesn't fit the Data stage's dual-pane (map + chart) behaviour (LOW probability, HIGH severity if it hits).**
The Data stage is not a single canvas — it switches between map view and chart view based on selection. If the stage abstraction forces a single `CanvasComponent`, the Data stage needs internal routing. The current design handles this: `CanvasComponent` is a React component that can render whatever it wants internally, including conditional branches. The stage abstraction does not mandate a single immutable view. This is only a risk if someone reads the contract as "one canvas, one layout" — document this explicitly in `StageDescriptor.ts`.

### 8.2 Explicit non-goals for this design

**Not redesigning any existing component's internals.** `SectionPanel`, `CptChart`, `BoreholeLog`, `MapView`, `InterpretationPane` are wrapped, not rewritten. Internal changes to those components are separate work items.

**Not building the Geology, Geotechnical, or Export stages.** S6 adds stubs; the full stages are Phase 4 follow-on and Phase 5 work respectively. The design only needs to prove the skeleton generalises — the stub accomplishes that.

**Not implementing full motion design.** Stage transition cross-fades are specified; the implementation is a single `transition-opacity` class. A full motion system (spring physics, shared element transitions) is post-v1.0 polish.

**Not migrating existing components to semantic tokens.** Existing `dark:slate-800` etc. classes stay. Only the new shell chrome uses semantic tokens in the initial build. The migration is a separate debt item.

**Not changing the .gmproj bundle format.** `active_section_id` is added to `view_state` as a new optional field (additive, v3 stays v3). All other persistence decisions use existing mechanisms.

**Not touching the backend.** This is a pure frontend restructuring. No new API endpoints, no schema changes, no migration.

---

## Appendix A — Debt updates

After this design ships, the following debt items should be updated:

- **Debt #12 (App.tsx → custom hooks split):** Mark resolved when Phase S2 completes and App.tsx is ~200–300 lines.
- **Debt #14 (Sidebar UI overhaul):** Mark resolved when Phase S7 completes (Geology stage migration). Not resolved by the initial shell build — the Sidebar's investigation-list content moves in S4, but the formation management content moves in S7.

Add a new debt item for the existing-component token migration:

```
## [NEW] Existing components — migrate to semantic color tokens (low)

What. Components authored before the shell redesign use raw Tailwind palette
steps (slate-800, blue-600) with dark: variants. After the token foundation
lands (Phase S1), these should migrate to semantic tokens so dark/light mode
is controlled from one place.

Why deferred. Components work correctly in both modes today via dark: variants.
Migration is mechanical but large — approximately 40 component files.

When. One component per sitting, opportunistically, as components are touched
for other reasons. Target: all shell-adjacent components (StageSpine,
Inspector, SectionsToolbar, SectionsInspector) done before v1.0 launch.
Leaf components (CptChart panels, borelog tracks, soil patterns) can wait for
Phase 5 polish.
```
