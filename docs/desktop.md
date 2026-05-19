# Desktop Frontend

Electron + React (TypeScript), built with `electron-vite`. Entry: `desktop/`.

```
desktop/src/
├── main/              Electron main process — spawns FastAPI, IPC handlers
├── preload/           Context bridge: openFile, readFile, waitForApi, menu events
└── renderer/src/
    ├── api/
    │   └── client.ts  Typed fetch wrappers; DuplicateCptError class for 409 handling
    ├── components/
    │   ├── ui/        Button.tsx — shared variant (primary/secondary/danger/ghost) + size (sm/md)
    │   ├── BboxDrawer.tsx     Inside MapContainer; crosshair draw mode for DOV bbox selection
    │   ├── CptChart.tsx   DOV-standard chart: type-aware panels, ghost axis alignment.
    │   │                  Header carries the inline ``ElevationEditor`` when an
    │   │                  ``onElevationChange`` handler is wired (Phase 3a).
    │   ├── ElevationEditor.tsx Inline manual-Z editor shared by CptChart and
    │   │                       BoreholeLog headers. Idle: amber "Set elevation"
    │   │                       link when null, "Z = X.XX m TAW" + pencil hover
    │   │                       when present. Editing: text+inputMode=decimal,
    │   │                       Enter saves, Esc cancels, "Clear" returns the
    │   │                       row to the "needs Z" state. Range-clamps to
    │   │                       [-500, 9000] m client-side mirroring the
    │   │                       ElevationPatchRequest server validator.
    │   ├── MapView.tsx    Leaflet map: CPT + borehole markers, layer-control dropdown
    │   │                  (Option B per-category expand), bottom-right legend.
    │   │                  Visibility state lives in App so Sidebar can read it too.
    │   ├── Sidebar.tsx    CPT + borehole list; sort dropdown (Default / Name / Depth);
    │   │                  multi-select checkboxes + bulk "Remove from project"
    │   │                  action bar; hover-trash for single-row remove. Removes are
    │   │                  project-local (localStorage), never DB delete.
    │   ├── BoreholeLog.tsx    Borelog SVG: lithology with patterns + admixture chips
    │   │                       (color swatch + qualifier code), drill method, field log,
    │   │                       sample track with lab-test family icons (★ for catch-all).
    │   │                       Header carries the inline ``ElevationEditor`` when an
    │   │                       ``onElevationChange`` handler is wired (Phase 3a).
    │   ├── LabTestPanel.tsx   Slide-in detail panel; ScalarTestsSection groups catch-all
    │   │                       tests by parametergroep, ASTM rows show D2487 description.
    │   ├── NewProjectDialog.tsx Modal for File → New Project. Replaces the
    │   │                        Electron-disabled ``window.prompt``. Name-only
    │   │                        MVP today; richer metadata editor extends this
    │   │                        component when task #16 ships.
    │   ├── Toolbar.tsx    Import button (GEF + DOV)
    │   └── WelcomeScreen.tsx  Shown when no project is loaded. Two-column
    │                          layout: Create / Open card on the left, Recent
    │                          Projects column on the right (hidden when empty).
    │                          Engineering-app convention — no auto-reopen on
    │                          launch (Plaxis / AutoCAD / Photoshop pattern).
    ├── utils/
    │   ├── soilColors.ts      108-code DOV hoofdnaam lookup → English label + color
    │   ├── soilPatterns.tsx   SVG <pattern> defs (FZ/KL/SI/LE/KA/GL/ZS/XZ/NN/ST/VE/SN…)
    │   ├── labTestLabels.ts   Translations for DOV parameter / parametergroep + USCS
    │   │                      D2487 ASTM code descriptions (CL → "Clay (lean)", …)
    │   ├── lithoLabels.ts     Dutch display-label helpers for lithostratigraphic units.
    │   │                      `formatLithoDisplayName(mainCode, admixtures)` composes
    │   │                      amount adjective + soil adjective + capitalised base name
    │   │                      (e.g. "matig kleiige Zand", "lokaal siltige Klei").
    │   │                      BASE_LITHOLOGIES: GRIND/ZAND/SILT/KLEI/VEEN. Admixture
    │   │                      soil codes: GL/KL/SL/ZN/VE + aliases G/K/S/V/Z.
    │   │                      Amount codes: W=weinig, M=matig, V=veel, S=sterk, Z=zwak,
    │   │                      WM/MV compounds. Translation at the presentation boundary —
    │   │                      raw DOV codes stored, Dutch label shown.
    │   ├── projectFile.ts     .gmproj file format helpers (build/serialise/parse).
    │   │                      Format version 1 — JSON pointer to a DB row. See
    │   │                      "Project files" below for the schema.
    │   ├── verticalDatum.ts   EPSG → datum-label lookup (5710→mTAW, 5709→NAP)
    │   └── useWgs84.ts        Lambert72 → WGS84 projection cache
    ├── hooks/
    │   └── useProject.ts  File-aware project hook. State: project (live
    │                      ProjectResponse from API) + filePath (.gmproj path).
    │                      Actions: newProject (POST + save dialog + write file,
    │                      with archive-rollback on cancel/error), openProjectFile,
    │                      pickAndOpenProject, updateMetadata, archiveCurrent,
    │                      closeProject. No auto-reopen — welcome screen is the
    │                      always-on launch surface.
    └── App.tsx            Project gate, data loading, import handlers, toasts.
                           Owns layer-visibility state (hidden CPT types, hidden
                           borehole values per axis, current axis) AND project-local
                           "removed" sets persisted to localStorage per project id.
                           Filters cpts/boreholes via removed sets before passing
                           anywhere user-visible.
```

## Sidebar conventions
- Sort persists per session: `localStorage["groundmodel.sidebar.sort"]`
- Removed-from-project set persists per project: `localStorage["groundmodel.removed.{projectId}.{cpt|borehole}"]`
- Multi-select checkbox ALWAYS visible (left of row icon); row body click opens detail
- Bulk action bar appears only when ≥1 selected; "Remove" + "Clear"; tab switch resets selection
- Hidden-by-map-filter rows go to the bottom of the list at `opacity-40`, still clickable
- Footer "N removed · restore all" link undoes everything in the active tab

## CptChart conventions
- `Y_W = 52` — width constant used for ALL Y-axes (real and ghost) to align plot areas across side-by-side `ComposedChart` panels
- Ghost axes: `tick={false} axisLine={false} tickLine={false} width={Y_W}` — reserve pixel space without display
- Level (mTAW) always on the leftmost panel's left axis; Length (m) always on the rightmost panel's right axis
- CPTU layout: u2 panel (kPa) | qc+fs panel | Rf panel
- CPTM layout: single panel with qc (black) + Qt total resistance from `q_total_mpa` (blue `#1d4ed8`) on same qc axis. The chart's `qt` data field falls back to `qt_mpa` for CPTU but renders the line only when present.
- Panel renderers are called as functions `{renderPanel(...)}` not JSX components — no hooks, avoids remount
- Colors: `QC_CLR=#111827`, `FS_CLR=#16a34a`, `RF_CLR=#b45309`, `U2_CLR=#7c3aed`, `QT_CLR=#1d4ed8`, `PD_CLR=#dc2626`
- `surfaceElevationRef` — ReferenceLine at depth=0 labelled with mTAW elevation when known
- `IcZoneLabelsOverlay` — absolute overlay at `bottom: 46` inside the Ic panel; each label is pinned at its zone's x-centre and rotated -55° (`transformOrigin: bottom center`) so they read diagonally upward; uses `IC_ZONE_SHORT` for abbreviated names in narrow zones

## Litho accept flow (Phase 1, #55)

Accept flow wires the Robertson-SBT / borehole suggestion output through to the geological model.

### Key handlers (useGeologicalModel)

- `handleAcceptLithoSuggestion(idx, sectionId?, applyUpdatedSection?)` — accepts one
  suggestion layer; calls `POST .../contacts/accept-litho-suggestions` (idempotent, server
  handles find-or-create formation + straddle split). MUST forward `sectionId` +
  `applyUpdatedSection` or the accepted contact's id won't land in
  `seeded_formation_contact_ids` → contact invisible on the section (#57 invariant).
- `handleAcceptAllLithoSuggestions(sectionId?, applyUpdatedSection?)` — bulk accept;
  same invariant applies.
- `handleRebuildLithoSurfaces()` — triggers `POST .../surfaces/rebuild` on the active litho
  model; lives on the LithologyToolbar Build button (not on SectionsToolbar).

### SectionsCanvas boundary

`sectionAwareAcceptLithoSuggestion` wraps `handleAcceptLithoSuggestion` at the
SectionsCanvas layer, closing over `selectedSection.id` and `applyUpdatedSection` so
`LithoSuggestionGhostColumns` doesn't need to know about sections at all.

Auto-load backdrop: a `useEffect` in SectionsCanvas fires `handleLoadBackdropSurfaces`
whenever `isLitho && effectiveBackdropModelId != null` — idempotent, cache-first. Placed
AFTER `effectiveBackdropModelId` declaration (TDZ guard).

### LithoSuggestionGhostColumns

- `spans_boundary: true` → amber (#d97706) dashed stroke (`4 2`); straddle note in tooltip.
- `formations` prop (geological `GeologicalFormationResponse[]`) → parent formation name
  resolved via a `formationNameById` Map (O(1), built once per render).
- `confidence` always shown in the SVG `<title>` tooltip.
- Props: `acceptedIndices`/`rejectedIndices` as `ReadonlySet<number>` for state visuals.

### LithoFormationRoster (LithologyInspector private)

Read-only roster of lithostratigraphic units grouped under parent geological formations,
ordered ascending by `display_order` (oldest first — superposition convention). Units
without `parent_formation_id` fall into an "Unassigned" group at the bottom. Each unit
row shows: colour swatch + name + contact count for THIS litho model. No edit/delete —
formation CRUD stays in GeologyInspector.

### LithoCompositionPickerDialog

Two-tab modal (`components/interpretation/LithoCompositionPickerDialog.tsx`) shown on
the lithostratigraphic axis when the user picks a depth on a section column
(`axisMode='lithostratigraphic'`). Replaces `FormationPickerDialog` on that axis.

**Tab 1 — Existing units.** Shows all `lithoFormations` grouped by parent geological
formation (resolved from `geoFormations` by `parent_formation_id`). Null-parent
formations fall into an "Unassigned" group at the bottom. Groups are sorted ascending
by parent `display_order`. Clicking a row calls `onSelect(formationId)`.

**Tab 2 — New unit.** Composition builder:
- Main soil code picker: `['GRIND', 'ZAND', 'SILT', 'KLEI', 'VEEN']` rendered as
  buttons. Default: `ZAND`.
- Admixture rows: soil code (`GL/ZN/SL/KL/VE`) + amount (`Z/W/M/V/S`) + "locally"
  checkbox. "Add admixture" button appends a row; trash icon removes one.
- Live preview (`data-testid="litho-preview"`): `formatLithoDisplayName(mainCode,
  admixtures)` updated on every change. Shows the Dutch label the user will see on
  the section.
- Confirm button ("Create unit") calls `onCreateLithoUnit(mainCode, admixtures)`.
  On a non-null result it chains into `onSelect(result.formationId)` and resets state.

**No-geology-context warning.** When `parentFormationName` is `null`, an amber banner
reads "No geological context at this investigation". The user CAN still confirm
(`parent_formation_id` will be `null` on the created unit — the server resolves the
TIN parent at accept-time). Never blocks placement.

**Props:**
| Prop | Type | Description |
|---|---|---|
| `open` | `boolean` | Show/hide the modal. |
| `lithoFormations` | `GeologicalFormationResponse[]` | All litho units for the project. |
| `geoFormations` | `GeologicalFormationResponse[]` | Parent geological formations for group labels. |
| `anchor` | `{kind, name, depth_m, elevationM} \| null` | The clicked investigation + depth. |
| `parentFormationName` | `string \| null` | Geological formation name at the clicked point. |
| `onSelect` | `(id: string) => Promise<void> \| void` | Called with a formation id to create the contact. |
| `onCreateLithoUnit` | `(code, admixtures) => Promise<{formationId} \| null>` | Create the unit, return the id. |
| `onCancel` | `() => void` | Dismiss without creating anything. |

**SectionsCanvas wiring.** `handleManualLithoUnitCreate` useCallback builds a
synthetic one-item `acceptLithoSuggestions` payload:
- `source: 'manual_pick'`
- `depth_base_m: depth_top_m + 0.01` (sentinel — prevents boundary-spanning splits)
- `parent_formation_id: null` (server resolves from geology TIN)
- `suggested_admixtures: admixtures`

On response: `updated_section` forwarded to `applyUpdatedSection` (#57 invariant,
both the created and found paths). `formationId` returned from
`created_formation_ids[0] ?? found_formation_ids[0]`. Prop wiring:
`axisMode={isLitho ? 'lithostratigraphic' : 'geological'}` and
`onManualLithoUnitCreate={isLitho ? handleManualLithoUnitCreate : undefined}` into
`SectionPanel`.
