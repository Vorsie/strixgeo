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
