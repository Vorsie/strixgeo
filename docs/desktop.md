# Desktop Frontend

Electron + React (TypeScript), built with `electron-vite`. Entry: `desktop/`.

```
desktop/src/
├── main/              Electron main process — spawns FastAPI, IPC handlers
│                      Backend launch: `.venv/Scripts/python.exe -m groundmodel.api.serve`
│                      (NOT `uvicorn.exe` — the entrypoint pins uvicorn's `loop`
│                      setting to a custom selector-loop factory on Windows; the
│                      proactor loop closes the listening socket on a transient
│                      accept error and never re-arms it. The event-loop POLICY
│                      is not a working hook here — uvicorn ≥ 0.36 reads
│                      `Config.get_loop_factory()`. See
│                      `src/groundmodel/api/serve.py`.)
│                      Renderer console → terminal (dev only, never packaged):
│                      `rendererConsoleForwarding.ts`. info/warning/error always
│                      forward; `debug` only with `STRIX_FORWARD_RENDERER_DEBUG=1`,
│                      mirroring the renderer's `localStorage['strix.log.trace']`
│                      switch — the debug stream is per-API-call and would flood
│                      the terminal a bug report is pasted from.
│                      Native menu bar follows the app language: `menuLabels.ts`
│                      (EN/NL label table) + `menuTemplate.ts` (pure template
│                      builder). The renderer owns the language and reports it
│                      over `window:set-language` (`setMenuLanguage` in preload)
│                      on boot and on every Settings flip; `buildMenu` rebuilds.
│                      First paint is seeded from the OS locale (`app.getLocale`).
├── preload/           Context bridge: openFile, readFile, waitForApi, menu events
└── renderer/src/
    ├── api/
    │   ├── client.ts      Barrel re-export — all types, error classes, setBaseUrl, and the
    │   │                  ``api`` object re-exported from per-domain sub-modules. Zero caller
    │   │                  changes required; import from ``api/client`` as before.
    │   └── clients/       Per-domain API modules (Move 2 of god-component decomposition):
    │       ├── shared.ts     HTTP primitives: _base, setBaseUrl, get/del/patch/put/post helpers
    │       ├── borehole.ts   BoreholeListItem, BoreholeDetailResponse, sample/lab types, boreholeClient
    │       ├── codelist.ts   G3Dv3, FormalStratigraphy, VirtueleBoringPredictions, codelistClient,
    │       │                 virtueleboringClient
    │       ├── cpt.ts        CptListItem, CptPlotResponse, DuplicateCptError, cptClient
    │       ├── geology.ts    All geological/litho/body types, DuplicateContactError,
    │       │                 ProvenanceViolationError, geologyClient, geotechnicalUnitClient
    │       ├── project.ts    ProjectResponse, ProjectBundleResponse, review types,
    │       │                 projectClient, reviewClient
    │       └── section.ts    CrossSectionResponse, DemSampleLineResponse, demClient, sectionClient
    ├── components/
    │   ├── ui/        Button.tsx — shared variant (primary/secondary/danger/ghost) + size (sm/md)
    │   ├── BboxDrawer.tsx       Inside MapContainer; crosshair draw mode for DOV bbox selection
    │   ├── CptChart.tsx         DOV-standard chart: type-aware panels, ghost axis alignment.
    │   │                        Header carries the inline ``ElevationEditor`` when an
    │   │                        ``onElevationChange`` handler is wired (Phase 3a).
    │   ├── ElevationEditor.tsx  Inline manual-Z editor shared by CptChart and
    │   │                        BoreholeLog headers.
    │   ├── MapView.tsx          Leaflet map: CPT + borehole markers, layer-control dropdown,
    │   │                        bottom-right legend.
    │   ├── BoreholeLog.tsx      Borelog SVG: lithology with patterns + admixture chips
    │   │                        (color swatch + qualifier code), drill method, field log,
    │   │                        sample track with lab-test family icons (★ for catch-all).
    │   ├── LabTestPanel.tsx     Slide-in detail panel; ScalarTestsSection groups catch-all
    │   │                        tests by parametergroep, ASTM rows show D2487 description.
    │   ├── NewProjectDialog.tsx Modal for File → New Project.
    │   ├── DovImportProgressPanel.tsx  SSE-streaming import progress panel (CPT + borehole).
    │   ├── SectionPanel.tsx     Cross-section SVG canvas; contacts/litho layers/correlation
    │   │                        overlays. Hosts ContactsLayer, CorrelationEdgesOverlay,
    │   │                        PartitionFillOverlay (band/onlap/lens fill).
    │   ├── SettingsDialog.tsx   Per-project litho-segmenter settings (snap tolerance, sliver
    │   │                        guard, correlation depth window, lens max thickness, …).
    │   └── WelcomeScreen.tsx    Shown when no project is loaded. Two-column layout:
    │                            Create / Open card on the left, Recent Projects on the right.
    │                            Engineering-app convention — no auto-reopen on launch.
    ├── components/borelog/      BoreholeLog sub-components (tracks, header, legend, …)
    │   └── components/BoreholeTracksDialog.tsx  The "Tracks" panel behind the borelog
    │                            toolbar button (2026-09-29): list of the borehole's tracks
    │                            (kind, DOV / Manual / Edited-by-hand badge, interval count,
    │                            drawn-in-sections flag), Add track (kind picker), Edit
    │                            (TrackIntervalEditor: Top/Base + DOV codelist pickers from
    │                            utils/dovTrackCodelists.ts, free text only for descriptions;
    │                            a new row starts at the last base, Enter in the last row adds
    │                            one), Delete (ConfirmDialog, Cancel focused, "Delete track").
    │                            Saves go through hooks/useBoreholeTrackEdits.ts (undoable
    │                            add/edit, detail refetch, markMutated, and a
    │                            hooks/boreholeTracksRevision.ts bump that makes an open
    │                            section refetch its borehole columns).
    │                            2026-09-30: Reset to DOV (whole borehole + per DOV
    │                            track; ResetToDovConfirm.tsx, Cancel focused, names how
    │                            many edited tracks lose their edits, no undo; a 409
    │                            no-source is a role=status notice), "Start from" a track
    │                            as template (utils/boreholeTracks.rowsFromTemplate), the
    │                            editor's read-only reference pane of the other tracks
    │                            (marks the intervals overlapping the focused row), and
    │                            max 3 admixtures per coded row (no fourth row offered).
    │                            A coded lithology started from a DESCRIPTION track reads
    │                            the codes word by word (utils/describedLithologyToCodes
    │                            + describedLithologyWords, vocabulary from the owner's
    │                            dov-desktopstudie classifier); every row needs a check
    │                            (DescriptionCheck.tsx). Fewer than half read = depths
    │                            only + one "could not read" notice (owner 2026-10-02).
    ├── components/interpretation/
    │   ├── FormationPickerDialog.tsx      Pick an existing geological formation.
    │   ├── LithoCompositionPickerDialog.tsx  Two-tab picker: existing units + new-unit builder.
    │   └── LithoGhostCompositionEditor.tsx   Inline admixture editor for ghost suggestion rows.
    ├── components/sections/     Section-canvas sub-components:
    │   ├── ContactsLayer.tsx        SVG contact lines + drag handles + snap indicators.
    │   ├── CorrelationEdgesOverlay.tsx  Ribbon rendering for correlation edges.
    │   ├── PartitionFillOverlay.tsx Band/onlap/lens partition fill + pinch
    │   │                            shaping (sole owner of section litho fill).
    │   ├── ColumnContextMenu.tsx    Right-click menu on a section column.
    │   └── BodyContextMenu.tsx      Right-click menu on a body (Dissolve / Name).
    ├── shell/
    │   ├── AppShell.tsx       Top-level layout shell: spine + stage canvas + inspector panel.
    │   ├── StageSpine.tsx     Left navigation spine — one button per stage.
    │   ├── StageToolbar.tsx   Horizontal toolbar slot above the stage canvas.
    │   ├── Inspector.tsx      Right-hand inspector panel slot.
    │   ├── EmptyState.tsx     Shared empty / loading state primitives.
    │   ├── ToolbarPrimitives.tsx  SplitToolbarButton + busy-spinner + iconOnly utilities.
    │   ├── ResponsiveToolbarRow.tsx  Stage-verb row: measures its space, renders the plan,
    │   │                  owns the "⋯ More" overflow menu. Every stage toolbar goes through it.
    │   ├── toolbarOverflow.ts     Pure planner — (item widths, available px) → which verbs are
    │   │                  full / short-form / icon / folded. No DOM reads, so no layout feedback
    │   │                  loop. See docs/ux.md "Stage toolbars" for the priority ladder.
    │   ├── toolbarOverflow_constants.ts  Text + chrome metrics the estimator measures with.
    │   ├── ShellContext.ts    React context + useShellContextValue hook for cross-stage state.
    │   ├── useShellState.ts   Core shell state: active stage, section selection, model axis.
    │   └── stages/
    │       ├── data/          DataStage — CPT + borehole list, DataCanvas, DataInspector, DataToolbar.
    │       ├── geology/       GeologyStage — GeologyCanvas (section editor), GeologyInspector,
    │       │                  GeologyToolbar, Geology3DViewer.
    │       ├── lithology/     LithologyStage — LithologyCanvas, LithologyInspector, LithologyToolbar.
    │       ├── geotechnical/  GeotechnicalStage scaffold (NAD packing class, CPT-derived indicators).
    │       ├── sections/      SectionsStage — SectionsCanvas, SectionsToolbar; the primary editing
    │       │                  surface for all three model levels.
    │       ├── parameters/    ParametersStage — per-test / per-unit / methods tabs (canvas;
    │       │                  the active tab rides coordinator.parametersActiveTab) +
    │       │                  ParametersInspector (per-test tab: the per-CPT plot surface —
    │       │                  header, click-to-edit water-table line, CptSbtDepthPanels;
    │       │                  per-unit tab: UnitListPane, the BODY TREE — R3 layout flip
    │       │                  2026-08-27, "statistics main, list in the pane").
    │       │                  The tree (owner ruling 2026-08-27, variant B) is
    │       │                  litho unit ▸ litho body ▸ NAD class ▸ geotech body;
    │       │                  litho units are ALWAYS listed (no litho/geotech either-or
    │       │                  roster). parameterBodyTree.ts is the ONE authority:
    │       │                  buildParameterTree + bandsForScope(scope) drive the pane,
    │       │                  the pooling, the counts and the cutout body set alike;
    │       │                  labels split into parameterScopeLabels.ts + the path header
    │       │                  into parameterScopeHeader.ts (500-line cap). Names (owner
    │       │                  2026-10-02): a unit row reads utils/formationUnitDisplayName
    │       │                  ("ZAND | matig siltig"), the raw token on its title; a litho
    │       │                  body reads "<its OWN home unit> · #<stored ordinal>" under
    │       │                  every row it sits; a body the roster lacks reads "Loading…",
    │       │                  never an id prefix. A geotech band's
    │       │                  litho body is derived live through litho_layer.parent_litho_
    │       │                  layer_id (Slice A). GROUPS ADD NO LEVEL (owner 2026-09-11):
    │       │                  a lone geotech body always folds into its class row, grouped
    │       │                  or not — that row wears "(group N)" and its checkbox; a click
    │       │                  on a grouped row selects the geotech-group scope
    │       │                  (unitTreeView.selectionScopeForNode) and EVERY member row
    │       │                  renders selected (unitTreeView.isRowSelected), its path opened.
    │       │                  Per-unit CANVAS = UnitStatisticsCanvas for
    │       │                  the scoped coordinator.selectedParameterUnit — a five-kind
    │       │                  union (litho-unit / litho-body / geotech-class / geotech-body /
    │       │                  geotech-unit; a litho scope pools the whole unit, all packing
    │       │                  classes): UnitDistributionPanels (qc/fs/Rf on the CPT plot's
    │       │                  fixed axes from utils/cptAxisScales.ts, pooled over the
    │       │                  canonical section-membership population only; fit-to-data
    │       │                  toggle S1, off-axis readings excluded + counted S2, derived
    │       │                  tick sublabels S3 — rows in UnitDistributionChannelRow,
    │       │                  shared AxisTickRow) +
    │       │                  UnitIdentificationPanels (OKP scatter, value × mTAW, from
    │       │                  borehole samples via detail-batch; own fit toggle S4 —
    │       │                  releases the Atterberg shared scale — and tick sublabels) +
    │       │                  UnitPsdPanel (S5 — every grain-size curve of the unit on ONE
    │       │                  inverted-log graph, pooled by unitPsd.ts on the same
    │       │                  midpoint-in-band rule) + UnitFenceCutout (lazy
    │       │                  Cesium fence walls of the SCOPE over the basemap, chromeless;
    │       │                  host verbs: Basemap on/off (per-viewer localStorage), Zoom to
    │       │                  unit (the filtered cutout's frame, 40 m floor) and Reset view
    │       │                  (whole model) — the camera never moves on its own;
    │       │                  the cutout body set is derived from bandsForScope, so a class
    │       │                  row shows every one of its bodies' walls). Section →
    │       │                  Parameters jump = the fallback ladder in
    │       │                  sections/geotechJumpLadder.ts (resolved body → geotech-body;
    │       │                  unresolved region with a unique litho parent → geotech-class;
    │       │                  else geotech-unit; litho surfaces → litho-body / litho-unit).
    │       │                  NOTE: the flow_unit_statistics e2e golden must be re-blessed
    │       │                  when this lands — the pane shape changed on purpose; the diff
    │       │                  image is the owner's call, do NOT re-bless blind.
    │       │                  Row click in the per-test table selects the CPT via
    │       │                  coordinator.handleSelectWithoutView (the plain
    │       │                  handleSelect also flips the DATA stage's view mode);
    │       │                  the inspector fetches /cpt/{id}/sbt-profile on demand,
    │       │                  under the engineer's Settings → Litho segmenter unit
    │       │                  weights, and fetches the plot itself if nothing else
    │       │                  did. Committing a water table calls markMutated, so
    │       │                  the edit shows as unsaved; clearing it restores the
    │       │                  file's value when the first override snapshotted one.
    │       └── export/        ExportStage — THE export hub (installer #35, the only
    │                          export surface): one card per export grouped by model
    │                          level (Section DXF · Plaxis 3D · litho D-Stability /
    │                          Plaxis 2D / fence · geotech D-Sheet / Plaxis 2D / fence ·
    │                          PDF sheet). useExportHub owns state + runs; section
    │                          exports reuse buildSectionExportPartition +
    │                          sectionExportPartitionArgs (byte-identical to the old
    │                          toolbar); fence via shared/makeProjectFenceBuilder.
    │                          The Sections toolbar + 3-D stages jump here via
    │                          coordinator.exportDeepLinkTarget.
    ├── hooks/
    │   ├── useProject.ts          File-aware project hook (open/save/archive/close).
    │   ├── useGeologicalModel.ts  Active model, contacts, litho layers, ghost suggestions,
    │   │                          correlation edges, accept/suggest/correlate handlers.
    │   ├── useSections.ts         Section list, active section, axis toggle.
    │   ├── useInvestigationData.ts  CPT + borehole detail fetch (scope-guarded).
    │   ├── useCrossingsValidation.ts  Surface-crossing validator hook.
    │   ├── useBoundaryDrag.ts     Shared boundary-drag state machine.
    │   ├── useLithoGhostWorkspace.ts  Pending litho suggestions: synchronous writes, one
    │   │                          undo command per gesture (a drag = one step), set aside
    │   │                          per litho model on a switch and restored on return.
    │   ├── useUndoStack.ts        Ctrl+Z / Ctrl+Y stack. A command carries an i18n KEY
    │   │                          (`undo.*`, typed against the EN catalogue) plus params,
    │   │                          never rendered text: the failure toast resolves it at
    │   │                          display time, so the language can switch mid-session.
    │   ├── useDovImportStream.ts  SSE-backed import progress hook.
    │   └── useShellContextValue.ts  Shell context value memoisation.
    ├── utils/
    │   ├── projectFile.ts     .gmproj file format helpers (build/serialise/parse).
    │   │                      Current format version: v3 (the only version the frontend
    │   │                      writes; pre-v3 files fail on open with "re-save" message).
    │   │                      v4 is a backend-only concept (the bundle API response shape
    │   │                      includes litho_layers natively); the frontend's
    │   │                      ``PROJECT_FILE_FORMAT_VERSION`` constant is 3 and v3 files
    │   │                      embed the backend's v4 bundle verbatim under the v3 wrapper.
    │   ├── soilColors.ts      108-code DOV hoofdnaam lookup → English label + color
    │   ├── soilPatterns.tsx   SVG <pattern> defs (FZ/KL/SI/LE/KA/GL/ZS/XZ/NN/ST/VE/SN…)
    │   ├── labTestLabels.ts   Translations for DOV parameter / parametergroep + USCS D2487
    │   ├── lithoLabels.ts     Dutch display-label helpers for lithostratigraphic units.
    │   │                      `formatLithoDisplayName(mainCode, admixtures)` composes
    │   │                      amount adjective + soil adjective + capitalised base name.
    │   ├── lithoConstants.ts  LITHOLOGY_COLORS, LITHOLOGY_LABELS — must stay byte-identical
    │   │                      to the backend mirror in ``shared/constants/litho_constants.py``.
    │   ├── lithoSegmenterPrefs.ts  read/write helpers for ``view_state.litho_segmenter.*``.
    │   ├── partitionFillV2/   computeSectionFillV2 — derives band/onlap/lens geometry
    │   │                      from contact-correlation counts (body shape source of truth).
    │   ├── verticalDatum.ts   EPSG → datum-label lookup (5710→mTAW, 5709→NAP)
    │   └── useWgs84.ts        Lambert72 → WGS84 projection cache (moved to hooks/ in practice)
    └── App.tsx                Project gate, data loading, import handlers, toasts.
```

## Shell / stage architecture

The app uses a **staged-screen shell** (`shell/AppShell.tsx`):

- The left `StageSpine` hosts one button per stage (Data / Geology / Lithology /
  Geotechnical / Sections / Parameters / Export).
- Each stage provides a `StageDescriptor` with a canvas component, toolbar component,
  and optional inspector component, registered in `StageRegistry`.
- Cross-stage state (active project, active geological model, active litho model, active
  section, selection) lives in `ShellContext` — read by any stage without prop-drilling.
- `useGeologicalModel` is the primary model-mutation hook; it is instantiated once in
  `useShellContextValue` and shared via context.
- The stage canvas slot is wrapped in a **per-stage `StageErrorBoundary`** (audit M5): a
  render crash inside a stage shows a "reset this stage" card in that slot — with a Reset
  that remounts only that stage (key bump) and a diagnostic captured through the local
  bridge — while the spine, toolbar, inspector and other stages keep working. Its
  `resetKey` is the active stage id, so navigating to a different stage clears a prior
  stage's crash. The root `ErrorBoundary` in `main.tsx` still backstops errors outside any
  stage (spine / toolbar / inspector).

**Project-scoped renderer state clears on every project change.** `useProject` clears the
`useWgs84` proj4 memo caches (`clearProjectScopedCaches`) on project open / switch / close
(audit L8 — the caches key by `(epsg, x, y)` and would otherwise grow across every project
in a session). `useInvestigationData` bumps a generation counter and empties its CPT /
borehole list + detail + plot caches on the same signal (Codex 3), and every list / detail
/ plot fetch discards its result if the generation moved on — so a slow request for project
A can never overwrite or repopulate project B. Map markers for project-owned CPTs / boreholes
project through the project's effective horizontal EPSG (`MapView` `projectEpsg`, Codex 2),
not a hardcoded Lambert-72; DOV pending pins stay explicit 31370.

The old flat-component `Sidebar.tsx` was deleted during the shell overhaul (#12). The
Data stage's `DataInspector` now hosts the CPT / borehole list with sort + multi-select
+ remove-from-project. Investigation-level visibility state (removed sets) persists per
project in `localStorage`; per-project engineering decisions (review status, view toggles)
ride in the `.gmproj` bundle, never in localStorage alone.

## Sidebar / Data stage conventions
- Sort persists per session: `localStorage["groundmodel.sidebar.sort"]`
- Removed-from-project set persists per project: `localStorage["groundmodel.removed.{projectId}.{cpt|borehole}"]`
- Multi-select checkbox ALWAYS visible (left of row icon); row body click opens detail
- Bulk action bar appears only when ≥1 selected; "Remove" + "Clear"; tab switch resets selection
- Hidden-by-map-filter rows go to the bottom of the list at `opacity-40`, still clickable
- Footer "N removed · restore all" link undoes everything in the active tab

## Raw lab tests (import, 2026-09-29 / 30)
- Data stage → Import → **Import lab tests** (`data.toolbar.importLabTest`, DataToolbar; the lab program is never named, owner 2026-09-30): multi-file picker (`.txt/.csv/.dat`), then `components/labSeries/LabSeriesImportDialog` walks the files one by one: `POST /lab-series/preview` (nothing written), the lab identity, the proposed borehole (select; a change re-previews so its samples are offered), the sample radio (proposed overlap, other samples, or "Create a new sample" with editable top/base — required when the export names no depth), every finding, then Import / Skip / Cancel. A 409 refresh opens a ConfirmDialog (Cancel focused, "Replace readings"). On finish: summary toast, `markMutated()` (File → Save writes the tests into the `.strix`), `loadBoreholeDetail` for touched boreholes, `notifyLabSeriesChanged()` (`hooks/useLabSeriesRevision`).
- Unknown file format (`LabFileFormatNotRecognisedError` from the client on the 400 code): the file is listed under "Not imported" with "Contact the StrixGeo dev team", counted failed, and the dialog moves to the next file; when the LAST file is refused the list stays until **Close**.
- Borehole fetched from DOV by the preview (`dov_lookup.status = "fetched"`): the hint reads "Fetched {name} from DOV.", the picker offers it (merged into the project list), and on finish the toast adds "Boreholes fetched from DOV: …" and `investigations.adoptImportedBoreholes(ids)` unhides + manifests + marks them imported-since-save and refetches the list. `not_found` / `unreachable`: a `role="alert"` line naming the borehole and the ways out (pick another borehole; add it to the project first / check the network); Import stays disabled until a borehole is picked. The preview POST is in `SLOW_MUTATION_HINTS` (the DOV fetch can outlast 60 s).
- Data inspector borehole rows show a flask marker (`data-testid="borehole-lab-marker"`, title "N lab tests" / "N labproeven") when `BoreholeListItem.lab_series_count > 0` (one grouped count in `GET /borehole/`). The map marker tooltip does not show it (the tooltip builder is not i18n-wired).
- BoreholeLog (when given `projectId`) shows `LabSeriesSection` under the log: one row per test (kind, sample interval, specimens / stages / readings, warnings badge), **View readings** opens `LabSeriesViewer` (modal): oedometer = settlement and derived strain vs log time per stage (stage picker; t = 0 reading as a left-edge marker; re-zero duplicates skipped and counted), end-of-stage strain vs log stress, the lab's e vs log stress; triaxial = deviator / pore pressure / volume change vs axial strain per specimen with the "no time channel" note; the "Reported by the lab" table (read-only) and the import findings. Charts: `LabSeriesChart` (own SVG: log x, one y axis, legend, nearest-point tooltip); data prep in `utils/labSeriesViewerData.ts`. The domain (`chartDomain`) keeps every drawn reading of every stage strictly inside the frame (owner 2026-09-30 "make sure full trap is visible in plots"): a log-x margin of 6 % of the decades spanned (at least 0.1 decade) each side, so the first reading clears the t = 0 edge marker and the last one the right frame; 5 % y margin over every drawn value and the t = 0 value.
- i18n: `locales/{en,nl}/labSeries.ts`.

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

## PDF CPT import dialog (`components/cptPdf/`)
Data → Import → "Import CPTs from a PDF report" (toolbar verb `import-verb-cpt-pdf`,
File menu `menu:import-cpt-pdf`). `useCptPdfImport` (App level) picks the report
and books the settled outcomes like every CPT import: one summary toast, new CPTs
into the manifest + session-import set, a replaced CPT → `markMutated` (never the
session-import set), list refetch, first CPT selected. The pipeline and the
owner rulings are in [parsers-cpt-pdf.md](parsers-cpt-pdf.md).
- `CptPdfImportDialog` — triage progress (`useCptPdfTriage`: upload → SSE job
  stream via the shared `utils/sseEvents.readSseEvents`, the same reader the DOV
  import uses) → list → per-sounding calibration → ONE `POST /cpt/pdf/import`.
  A `confirmation_required` sounding is asked with `CptRefreshConfirmDialog`
  (Cancel focused, "Replace data"), one at a time; only the agreed ones are
  re-posted with `confirm_refresh`. Ends on `CptPdfImportReport` (per-sounding
  status + the digitiser's remarks).
- `CptPdfTriageList` — campaign soundings with an 80 dpi page thumbnail
  (`GET /cpt/pdf/page/...png`), all ticked; unknown-origin soundings apart and
  unticked; a collapsed "Not imported" block naming the desk-study ids once plus
  the repeated / unread sheets; the "tick reading unavailable" note when the
  backend has no OCR.
- `CptPdfCalibrationOverlay` — the backend's overlay PNG (frames cyan, digitised
  curve orange) with an SVG of draggable frame corners on top; per panel the two
  tick values of each axis (`NumericInput`), the quantity (`<select>`), and an
  eyedropper (one-pixel canvas read → curve colour → re-extract). "Re-extract"
  posts the calibration dicts to `/cpt/pdf/digitise`; the header fields the sheet
  did not print (X, Y, EPSG default 31370, ground level, date) are typed here.
  The dict edits are pure functions in `cptPdfCalibrationEdits.ts`; an axis anchor
  on a dragged frame edge moves with it, one on a tick inside the frame stays.
- `CptProvenanceTag` — "digitised from <file>, p. <pages>" on the CPT chart for a
  CPT whose `import_provenance.source` is `pdf-digitised`; `ElevationEditor`
  labels its Z source "(PDF)".

## Litho accept flow (Phase 1, #55)

Accept flow wires the Robertson-SBT / borehole suggestion output through to the geological model.

### Key handlers (useGeologicalModel)

- `handleAcceptLithoSuggestion(idx, sectionId?, applyUpdatedSection?)` — accepts one
  suggestion layer; calls `POST .../layers/accept-litho-suggestions` (idempotent, server
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

### LithologyInspector composition (debt #201)

`LithologyInspector.tsx` is a thin orchestrator (~405 lines) that owns the hooks + state;
its panel sections are presentational sibling files in the same `lithology/` folder:
`ModelKindPicker`, `LithoConfidenceFadeToggle`, `LithoCommittedPill`, `LithoResolveAction`,
`LithoFormationRoster` (+ its module-scope `LithoUnitRow`), `LithoSolidLegend`,
`LithoBoreholesInModel`, `LithoExcludedBoreholes`, plus the inline clear-model `Modal` and
`ConfirmParentDialog`. Props flow down, callbacks up — the extracted pieces hold no shared
state (only `LithoSolidLegend` keeps its own per-group expand/collapse state).

### GeologyInspector composition (debt #201)

`GeologyInspector.tsx` is a thin orchestrator (~388 lines) that composes the geology stage
inspector. Because it carried ~400 lines of undo-command formation-CRUD handlers (unlike the
lithology round), the formation-roster CRUD + drag-reorder block moved into a custom hook
`useGeologyFormations.ts`, with the intricate reorder logic + undo split into the pure
`reorderFormationsCommand.ts` (file-cap). The panel sections are presentational sibling files
in the same `geology/` folder: `GeologyInspectorHeader`, `GeologyConfidenceFadeToggle`,
`GeologyCrossingsBanner`, `GeologyFormationList` (+ its module-scope `GeologyFormationRow`),
and `GeologyBoreholesInModel` (owns its own collapse state); the add-formation `Button`, the
`CrossingSectionPickerDialog`, the empty-state hint, the `FormationDialog`, and the
delete-confirm `Modal` (which carries a justified `eslint-disable jsx-a11y/no-autofocus`)
stay inline. Props flow down, callbacks up. Formation CRUD stays here (litho's
`LithoFormationRoster` is read-only by design). The original
`reorderFormations → visibleFormations` TDZ constraint is gone: the reorder derives its
visible list inline inside the hook. `GeologyConfidenceFadeToggle` is a near-duplicate of the
lithology `LithoConfidenceFadeToggle` (differ only in `data-testid` + hint key), kept as a
sibling copy to keep the round inside the `geology/` folder.

### LithoFormationRoster (LithologyInspector sibling)

Read-only FLAT roster of lithostratigraphic units, ordered ascending by `display_order`
(oldest first — superposition convention). Under A2 litho units are geo-agnostic
(`parent_formation_id` always null on accept), so there are no parent-group headers or an
"Unassigned" bucket — the flat list is honest. Each unit row shows: colour swatch + name +
contact count for THIS litho model. No edit/delete — formation CRUD stays in
GeologyInspector.

### LithoBoreholesInModel + LithoExcludedBoreholes (LithologyInspector sibling)

Both surface the active litho model's `excluded_borehole_ids` (debt #65, RESOLVED
2026-09-03) and route every write through `geoModel.handleToggleBoreholeInLithoModel`,
which shares `hooks/boreholeExclusionToggle.ts` (the optimistic/reversible toggle) with
the GeologyInspector borehole checkbox — one copy of the mechanics, no second rollback
path.

`shell/stages/lithology/LithoBoreholesInModel.tsx` — the **exclude gesture**, mirroring
GeologyInspector's collapsible "Boreholes in model" checkbox roster. Collapsed by
default; when open it lists every `visibleBoreholes` row with a checkbox (checked = in
the litho build, unchecked = excluded, line-through) plus an included/total count in the
header. Unchecking excludes, re-checking includes — both reversible, fire immediately
with NO confirm dialog (a project-local membership change), Ctrl+Z undo + a confirmation
toast. Renders nothing when the project has no boreholes.

`shell/stages/lithology/LithoExcludedBoreholes.tsx` — the compact undo callout below the
roster. Renders only when the model excludes something; one row per excluded borehole
(name resolved from `visibleBoreholes`, generic fallback for a since-removed borehole)
with a per-row "Include again" — the same reversible toggle in the include direction.

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

### Litho correlation connect gesture (Slice 4, #67 resolved)

**State machine — `useCorrelate` hook** (`components/sections/useCorrelate.ts`):
```
Idle → enterMode() → Mode (no source)
Mode → arm(source) → Armed
Armed → clearArmed() → Mode  (Esc L1)
Mode → exitMode() → Idle  (Esc L2)
```
Lifted into `UseSectionsResult` + shell bus so both SectionsToolbar and SectionsCanvas
read the same state. `setSectionModelAxis` wrapper clears correlate state on axis switch;
`selectedSectionId` effect clears on section switch.

**Toolbar** — `GitMerge` `CorrelateButton` in the `{isLitho && …}` block:
- Hidden on geological axis.
- Disabled when `activeLithoModel === null` or `selectedSectionId === null`.
- Label "Correlate" / "Correlating…" (active); amber tint when mode is on.
- Click toggles `enterCorrelateMode` / `exitCorrelateMode`.

**SectionsCanvas boundary** (`SectionsCanvas.tsx`):
- `correlationEdges: LithoCorrelationEdge[]` state; `refetchEdges` via
  `api.geology.listCorrelations`; useEffect keyed on `[isLitho, activeLithoModel?.id, selectedSectionId]`.
- `handleCorrelate(aId, bId)`: POST → resolveLithoInstances → refetchEdges →
  clearCorrelationSource. No toast on success (owner-decided).
- `handleUncorrelate(aId, bId)`: optimistic local removal → DELETE →
  resolveLithoInstances → refetchEdges; rollback (full refetch) on failure.
- `correlateGestureState` useMemo → `CorrelateGestureState` (absent on geological axis).
- Passes `correlationEdges={isLitho ? correlationEdges : undefined}` and
  `correlateGestureState` to SectionPanel.

**CorrelationEdgesOverlay** (`components/sections/CorrelationEdgesOverlay.tsx`):
SVG `<g>` mounted inside SectionPanel's SVG when `correlationEdges !== undefined`.

Edge rendering (always-on when edges exist):
- Invisible hit line (16px wide, transparent) for right-click uncorrelate.
- Visible dashed blue line: stroke `#3b82f6`, width 1.5px, dash `5 3`.
- EdgeBadge at midpoint: "body N" (dark navy background) or "?" (amber #d97706) when
  `instance_ordinal` is null.
- Dangling suppression: edges only render when BOTH formations have a column on the
  section (both x + midY resolvable).

Correlate-mode gesture rects (only when `correlateGestureState.correlateMode`):
- No source armed: crosshair arm rect (`data-testid="correlate-arm-{invId}-{fId}"`).
- Source armed (isSource): 2px accent outline + floating label above band; click = clearArmed.
- Valid target (`isValidTarget`): dim blue tint + dashed border (`data-testid="correlate-target-{invId}-{fId}"`); click = onCorrelate(source.formationId, gr.formationId).
- Cross-group (placeholder for Phase 5 enforcement): not-allowed cursor + SVG title tooltip.

True-spacing warning: amber italic text at plotTop − 4 when `correlateMode && any adjacent pair of columns < 1 m apart (proj.along delta)`.

Esc peel in SectionPanel's keydown handler (LIFO):
1. contextMenu → dismissContextMenu
2. correlationSource armed → onClearArmed (stay in mode)
3. correlateMode → onExitMode
4. focusedColumn → exitFocus
