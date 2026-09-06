// Guided-tutorial copy (debt #93, owner ruling 24; spec
// docs/superpowers/specs/2026-09-02-guided-tutorial-design.md).
//
// Part of the English message catalogue, see 'locales/en/index.ts' for the
// key-naming rules. Keys are `tutorial.chapter.<n>`, `tutorial.<stepId>.title|body`
// and `tutorial.ui.*` for the coach-card chrome.
//
// Chapters 1-8 all carry full drafted copy (2-4 short sentences a step). ALL
// wording is a DRAFT for the owner's review. Behaviour described here is derived
// from the real controls, never invented (brief: "never invent behaviour").
// Product names (StrixGeo, DOV, Plaxis, D-Stability, DXF, NAD) stay raw tokens.

export const TUTORIAL = {
  // Chapter titles ----------------------------------------------------------
  'tutorial.chapter.1': 'Your project',
  'tutorial.chapter.2': 'Import data',
  'tutorial.chapter.3': 'Cross-sections',
  'tutorial.chapter.4': 'Stratigraphic model',
  'tutorial.chapter.5': 'Lithological model',
  'tutorial.chapter.6': 'Geotechnical model',
  'tutorial.chapter.7': 'Parameters & statistics',
  'tutorial.chapter.8': 'Export',

  // Coach-card chrome -------------------------------------------------------
  'tutorial.ui.back': 'Back',
  'tutorial.ui.next': 'Next',
  'tutorial.ui.skipStep': 'Skip step',
  'tutorial.ui.skipTutorial': 'Skip tutorial',
  'tutorial.ui.finish': 'Finish',
  'tutorial.ui.watchClip': 'Watch the clip',
  'tutorial.ui.progress': 'Chapter {chapter} of {chapterCount} · Step {step} of {stepCount}',
  'tutorial.ui.doItHint': 'Do this in the app, the tutorial moves on by itself when you do.',
  'tutorial.ui.openTab': 'Open the highlighted tab to find this control.',
  'tutorial.ui.offscreen': "The control isn't on screen right now, the tip stays here until it is.",

  // 1 · Your project --------------------------------------------------------
  'tutorial.project-name.title': 'Name your project',
  'tutorial.project-name.body':
    "Every project starts with a name. Use something you'll recognise later, your job number and the site, like GEO-22/040 Brugge. Client, phase and other details can be added afterwards.",
  'tutorial.project-create.title': 'Create the project',
  'tutorial.project-create.body':
    'Click Create project to open it. From here on every CPT, borehole, section and model lives inside this project and is saved with it.',
  'tutorial.project-metadata.title': 'Open the project settings',
  'tutorial.project-metadata.body':
    'Your coordinate system and vertical datum live in the project settings. Click the project name at the top of the window to open them, the same panel where you edit the client, site and tags later.',
  'tutorial.project-crs.title': 'Set the coordinate system',
  'tutorial.project-crs.body':
    'Open the project metadata and choose the horizontal CRS: Lambert 72 (EPSG 31370) for Belgium, RD New (EPSG 28992) for the Netherlands. It must match how your data was surveyed, or every location lands in the wrong place.',
  'tutorial.project-datum.title': 'Set the vertical datum',
  'tutorial.project-datum.body':
    'The vertical datum is the zero that every elevation is measured from, TAW in Belgium, NAP in the Netherlands. Pick the one your levels use so depths and surface heights read correctly across the whole model.',

  // 2 · Import --------------------------------------------------------------
  'tutorial.import-open.title': 'The Import menu',
  'tutorial.import-open.body':
    'This is where data comes in. Open it to see every importer StrixGeo offers today, CPTs and boreholes, from local files or straight from DOV.',
  'tutorial.import-cpt-dov.title': 'Import CPTs from DOV',
  'tutorial.import-cpt-dov.body':
    "Choose 'Import CPT from DOV', then drag a box on the map. Every sounding DOV holds inside that box streams in with its depth series and location. This step ticks itself once your first CPT lands.",
  'tutorial.import-filter-date.title': 'Filter by date',
  'tutorial.import-filter-date.body':
    'Long lists get unwieldy. Set a date range to show only the investigations from the period you are working on, and clear it to see them all again.',
  'tutorial.import-filter-type.title': 'Filter by test type',
  'tutorial.import-filter-type.body':
    'Switch between CPTs and boreholes here. Each tab shows only that kind of investigation, so you can work through one type at a time.',
  'tutorial.import-hide.title': 'Hide a test',
  'tutorial.import-hide.body':
    "Not every sounding belongs in your dataset. Remove one to hide it from this project, a reversible, project-local hide you can restore any time. The data itself is never deleted.",
  'tutorial.import-borehole-dov.title': 'Import boreholes from DOV',
  'tutorial.import-borehole-dov.body':
    "Boreholes come in the same way: choose 'Import Borehole from DOV' and draw a box on the map. This step ticks once your first borehole lands.",
  'tutorial.import-gef.title': 'Import local GEF files',
  'tutorial.import-gef.body':
    "Have CPTs on disk? 'Import CPT (.gef)' reads standard GEF files straight from your computer, useful for soundings that are not in DOV.",
  'tutorial.import-more.title': 'More sources are coming',
  'tutorial.import-more.body':
    "DMT, lab tests and monitoring data are on the roadmap, you'll see them marked 'Phase 4' in the menu for now.",
  'tutorial.import-closing.title': 'Need another format?',
  'tutorial.import-closing.body':
    'More importers are coming, depending on what you need, send the file formats you use to StrixGeo and we build the parser.',

  // 3 · Cross-sections ------------------------------------------------------
  'tutorial.section-create.title': 'Create a cross-section',
  'tutorial.section-create.body':
    'A cross-section is where you build and edit all three models. Create your first one, draw the line through the investigations you want to correlate. Once it opens, double-click any column to read that test in full detail. This step ticks once a section exists.',
  'tutorial.section-buffer.title': 'Projection buffer',
  'tutorial.section-buffer.body':
    'The buffer is how far to either side of the section line a test can sit and still be projected onto it. Widen it to catch more soundings, narrow it to keep only the ones right on the line.',
  'tutorial.section-spacing.title': 'Column spacing',
  'tutorial.section-spacing.body':
    'Spacing spreads the projected columns apart so overlapping tests stop hiding each other. At 0% each test sits at its true along-section position; higher values trade that for legibility.',
  'tutorial.section-vexag.title': 'Vertical exaggeration',
  'tutorial.section-vexag.body':
    'Ground is far wider than it is deep, so thin layers vanish at true scale. Vertical exaggeration stretches the depth axis to make them readable, only the drawing is stretched, the numbers stay real.',
  'tutorial.section-channels.title': 'CPT data channels',
  'tutorial.section-channels.body':
    'Toggle the CPT traces, qc, Rf, fs, u2 and qT, to show only the ones you are reading. Fewer channels means a cleaner column when you correlate layers.',
  'tutorial.section-boreholes.title': 'Borehole interpretation streams',
  'tutorial.section-boreholes.body':
    'A borehole can carry several interpretation streams. Toggle Geo (geotechnical coding), F-Strat (formal stratigraphy) and I-Strat (informal stratigraphy) next to the CPT channels, each stream you turn on draws as its own strip beside the borehole. Geo is on by default.',
  'tutorial.section-axis.title': 'Model axis',
  'tutorial.section-axis.body':
    'The same section edits all three levels. Switch the axis between Stratigraphy, Litho and Geotech to work on each model in turn without leaving the section.',
  'tutorial.section-snap.title': 'Snap to stratigraphy',
  'tutorial.section-snap.body':
    'With Snap on, a click near a logged boundary lands exactly on it instead of a pixel off. It keeps your contacts tied to the stratigraphy the boreholes actually record.',
  'tutorial.section-dem.title': 'The ground surface',
  'tutorial.section-dem.body':
    'The grey line across the top is the terrain from the DEM, drawn automatically wherever the ground level is known. It is the reference your elevations hang from.',
  'tutorial.section-persist.title': 'Your view is saved',
  'tutorial.section-persist.body':
    'Zoom in and out with the plus and minus buttons; the scale read-out states the exact horizontal and vertical scale. Every setting here (buffer, spacing, exaggeration, channels, snap, zoom) saves to this section on its own, so reopening it restores the framing; Reset returns the default view and the X closes the section.',
  'tutorial.section-undo.title': 'Undo',
  'tutorial.section-undo.body':
    'Undo steps back through your model edits, including an accepted litho layer. It is also on Ctrl+Z; the button makes the stack visible.',
  'tutorial.section-tie.title': 'Tie cross-sections',
  'tutorial.section-tie.body':
    'When you have more than one section, Suggest tie-sections proposes short links where they cross, and the caret accepts them all at once. The ties give the 3-D build data to interpolate between your lines.',
  'tutorial.section-delete.title': 'Delete a cross-section',
  'tutorial.section-delete.body':
    'Delete removes the selected cross-section. It is irreversible, so it always confirms first; the underlying CPTs and boreholes are never touched.',
  'tutorial.section-export.title': 'Export this section',
  'tutorial.section-export.body':
    'The Export dropdown sends the open section to DXF, to Plaxis, to D-Stability or D-Sheet, or to a PDF sheet. Each file carries the model level the axis is on. The Export stage gathers the same targets in one place.',
  'tutorial.section-inspector.title': 'The section panel',
  'tutorial.section-inspector.body':
    'The right panel lists your cross-sections and carries the model verbs for the open axis: Build the surfaces, Seed contacts from stratigraphy, and Dedupe. It is the panel companion to the toolbar verbs.',

  // 4 · Geological model ----------------------------------------------------
  'tutorial.geo-open.title': 'Open the Stratigraphy stage',
  'tutorial.geo-open.body':
    'The stratigraphic model is the backbone of the ground model. It holds the formations and the surfaces between them, the regional layers under your whole site. Build it first, then the litho and geotech models refine it from there.',
  'tutorial.geo-seed.title': 'Fill from boreholes',
  'tutorial.geo-seed.body':
    "Fill the model's first contacts from your boreholes. This button reads the formation tops the boreholes log and places a contact at each one. This step ticks itself once the first contacts appear.",
  'tutorial.geo-lumping.title': 'Same unit, different name',
  'tutorial.geo-lumping.body':
    'Sometimes two logged units are the same formation under different names. Lump the stratigraphy to tell the model they are one. From there the contacts extend onto the CPT columns too, so the whole section reads as one story. This step ticks once a lumping exists.',
  'tutorial.geo-second-section.title': 'Draw a second cross-section',
  'tutorial.geo-second-section.body':
    'Before you build the surfaces, draw a second cross-section across the site. One line gives each surface a single profile; a second line gives it the 3-D data to interpolate between. Draw it the same way you drew the first.',
  'tutorial.geo-surfaces.title': 'Build the surfaces',
  'tutorial.geo-surfaces.body':
    'Build the formation surfaces from the contacts. StrixGeo fits one surface through each formation top. Then check the crossings the validator reports, because the formations have to stay in order for the model to be valid. This step ticks once the surfaces are built.',

  // 5 · Lithostratigraphic model --------------------------------------------
  'tutorial.litho-open.title': 'Open the Lithology stage',
  'tutorial.litho-open.body':
    'The lithological model refines the stratigraphic backbone into lithological units. Think sand, clay, silt, gravel and peat, with their admixtures. You build it along your cross-sections, one column at a time.',
  'tutorial.litho-create.title': 'Create a lithological model',
  'tutorial.litho-create.body':
    'The litho model is a separate ground-model axis under the stratigraphic one. Create it first: until it exists the Litho and Geotech axis pills stay locked and there is nothing to pick litho contacts onto. Give it a name and it becomes the active litho model; this step ticks once the model exists.',
  'tutorial.litho-axis.title': 'Switch to the litho axis',
  'tutorial.litho-axis.body':
    'Open a cross-section and switch its axis to Litho. The Litho pill unlocks the moment the litho model exists, so you reach it right after creating the model. The same section now edits the litho model instead of the stratigraphy, and every suggestion and correlation you make from here belongs to it.',
  'tutorial.litho-accept.title': 'Accept the suggestions',
  'tutorial.litho-accept.body':
    'The segmenter proposes litho layers on each column, reading the CPT with a Robertson classification. Accept the ones that match what you see. This is assisted work, not automatic correlation, so you stay in control of every layer. This step ticks once you accept your first suggestion.',
  'tutorial.litho-adjust.title': 'Merge and adjust layers',
  'tutorial.litho-adjust.body':
    "Accepted layers are yours to refine. Drag a boundary to move it; Shift-drag past the neighbour's midpoint to absorb it; Alt-drag copies a layer's composition onto another column; right-click a layer for “Merge layers” and more.",
  'tutorial.litho-correlate.title': 'Correlate the layers',
  'tutorial.litho-correlate.body':
    'Before you build, correlate a layer on one column to the same layer on the next, so the model knows they are one body. Correlate at the top of the litho toolbar arms the two-click gesture; Auto-correlate proposes the ties across the whole model for you to accept.',
  'tutorial.litho-second-section.title': 'A second section for 3-D',
  'tutorial.litho-second-section.body':
    'As with the stratigraphy, a single section carries only one profile. Draw a second cross-section so the litho bodies have the 3-D data to connect between your sections.',
  'tutorial.litho-build.title': 'Build the litho bodies',
  'tutorial.litho-build.body':
    'Build turns the accepted, correlated layers into connected litho bodies in 3-D. Each mass that joins across your sections becomes one body. This step ticks once the litho solids exist.',

  // 6 · Geotechnical model --------------------------------------------------
  'tutorial.geotech-open.title': 'Open the Geotechnics stage',
  'tutorial.geotech-open.body':
    'The geotechnical model subdivides the litho units into NAD packing classes. It reads CPT-derived indicators like qc and relative density, so these are characterisation estimates, not design values. Your design numbers come later, in your design tool.',
  'tutorial.geotech-subdivide.title': 'Run the packing pipeline',
  'tutorial.geotech-subdivide.body':
    'On a cross-section, switch to the Geotech axis and open the packing pipeline. The Geotech pill unlocks once a litho model exists, because the pipeline builds the geotechnical model from the litho units. It runs in four steps: subdivide the CPTs so each litho unit splits into its packing classes, propose and accept the packing correlations, then divide the boreholes to carry the classes across. This step ticks once the geotechnical model exists.',
  'tutorial.geotech-bodies.title': 'Recompute and group bodies',
  'tutorial.geotech-bodies.body':
    'Recompute the bodies to settle which masses count as one geotechnical body. Use Join with to group similar masses, so you carry more data and fewer export classes. Use Un-join to lift a body back out of a group. Then Build the 3-D geotechnical model.',

  // 7 · Parameters & statistics ---------------------------------------------
  'tutorial.params-open.title': 'Open the Parameters stage',
  'tutorial.params-open.body':
    'The Parameters stage is where the finished model reports on itself. The unit tree, the per-unit statistics and the fence cutout all live here. Everything here is characterisation, never a design calculation.',
  'tutorial.params-jump.title': 'Jump here from a section',
  'tutorial.params-jump.body':
    'You reach this stage straight from a cross-section too: right-click a body band and choose “Unit statistics…”. It opens the Parameters stage with that unit already selected, so you go from a shape on the section to its numbers in one step.',
  'tutorial.params-stats.title': 'Per-unit statistics',
  'tutorial.params-stats.body':
    'Pick a unit to see its statistics, pooled across every body that belongs to it. The fence cutout shows that same unit in the ground, so you can check the number against the shape. These are characterisation statistics, not design parameters.',

  // 8 · Export --------------------------------------------------------------
  'tutorial.export-open.title': 'Open the Export stage',
  'tutorial.export-open.body':
    'Send the finished three-level model to your design tools. StrixGeo hands over the ground model, and the design checks happen in the tool you export to. Choose the format your next tool needs.',
  'tutorial.export-dxf.title': 'Export a cross-section',
  'tutorial.export-dxf.body':
    'Pick a cross-section, then export it to DXF for CAD or to a runnable Plaxis 2-D script. Each export carries your unit identifiers, so the model arrives labelled in the design tool.',
  'tutorial.export-plaxis3d.title': 'Export the 3-D model',
  'tutorial.export-plaxis3d.body':
    'Export the whole stratigraphic model as a runnable Plaxis 3-D script. It is model-wide rather than section-scoped, so it needs a built stratigraphic model, not a single section.',
  'tutorial.closing.title': "You're all set",
  'tutorial.closing.body':
    'That is the whole workflow: import, section, stratigraphy, litho, geotech, parameters, export. Build your first model on your own data. More importers and exporters are coming, so send the file formats you use to StrixGeo and we build them next.',

  // Added-button + owner-ruling steps (2026-09-05) ---------------------------
  'tutorial.import-search.title': 'Search the list',
  'tutorial.import-search.body':
    'Type in the search box to filter the current tab by name. It matches as you type; clear it to see every investigation again.',
  'tutorial.import-sort.title': 'Sort the list',
  'tutorial.import-sort.body':
    'Sort the investigations by name, depth or date and flip the direction. Sorting is a view aid; it never changes the data.',
  'tutorial.import-remove-cptm.title': 'Remove the mechanical cones',
  'tutorial.import-remove-cptm.body':
    'Mechanical cones (CPTM) carry no friction or pore pressure, so leave them out. Uncheck CPTM in the map test-type filter; the greyed rows then sit at the bottom of the CPT list. Click the first, Shift-click the last, and press Delete to remove them from the project.',
  'tutorial.data-open-cpt.title': 'Open a CPT',
  'tutorial.data-open-cpt.body':
    'Click a CPT row to open its chart. Read qc, fs, Rf and u2 against the depth axis; where DOV supplies a layer model it shows beside the traces. This step ticks once a CPT chart is open.',
  'tutorial.data-open-borehole.title': 'Open a borehole',
  'tutorial.data-open-borehole.body':
    'Click a borehole row to open its log. It shows the described layers and the classification tests logged with the borehole, including the lab results. This step ticks once a borehole log is open.',
  'tutorial.geo-add-formation.title': 'Add a formation',
  'tutorial.geo-add-formation.body':
    'The panel lists the formations in the model, youngest at the top. Add one by hand when a unit is missing, drag to reorder them, and use the confidence-fade toggle to dim extrapolated ground away from the data.',
  'tutorial.geo-boreholes-in-model.title': 'Boreholes in the model',
  'tutorial.geo-boreholes-in-model.body':
    'This roster decides which boreholes anchor the model. Uncheck one to leave it out of the surfaces while it still draws on the section; re-check to include it again. Both are reversible.',
  'tutorial.geo-dedupe.title': 'Dedupe contacts',
  'tutorial.geo-dedupe.body':
    'Dedupe removes duplicate formation contacts that stack up after repeated fills. It deletes rows, so it confirms first and names how many it found.',
  'tutorial.geo-reset-delete.title': 'Reset view and delete',
  'tutorial.geo-reset-delete.body':
    'Reset view flies the 3-D camera back to the model and collapses a split viewport. Delete stratigraphy removes the whole model, every formation, contact and surface, so it always confirms first.',
  'tutorial.geo-carry-strat.title': 'Carry the stratigraphy onto the CPTs',
  'tutorial.geo-carry-strat.body':
    'Hold Shift and drag a borehole contact sideways across the neighbouring CPT columns; it paints a copy onto every column you pass over, so the CPTs carry the same subdivision. To carry several boundaries at once, Shift-click the bottom contact to select the whole range first (or Shift-drag over them), then drag the group across together. Set the contacts right before you build the model, and do this on both cross-sections.',
  'tutorial.litho-suggest.title': 'Suggest litho layers',
  'tutorial.litho-suggest.body':
    'Suggest reads the focused column with a Robertson classification and proposes litho layers as ghost boundaries. The caret offers the bulk variants: suggest for the whole section, or only for new tests.',
  'tutorial.litho-bodies.title': 'Body view options',
  'tutorial.litho-bodies.body':
    'The Bodies menu gathers the view switches: fill the bands, show or hide the correlation ribbons and the built-model fill, reset your hand-drawn boundary points, and toggle the sample markers.',
  'tutorial.litho-admixtures.title': 'Admixtures',
  'tutorial.litho-admixtures.body':
    'The Admixtures menu cleans up the ghost suggestions before you accept them: strip the CPT or borehole admixtures, strip them all, or reseed from the borehole observation log.',
  'tutorial.litho-fence.title': 'Export the litho fence',
  'tutorial.litho-fence.body':
    'Once the solids are built, Export fence writes the 3-D fence diagram to DXF. It sits next to Build model on this stage and refuses with a warning unless the view is in Fence mode.',
  'tutorial.litho-pane.title': 'The lithology panel',
  'tutorial.litho-pane.body':
    'The panel carries the model picker, the confidence-fade toggle, the unit roster with its body legend, Resolve instances to refresh the roster, and the boreholes-in-model scope. Clear model wipes the litho contacts after a confirmation.',
  'tutorial.geotech-statistic.title': 'Choose the representative qc',
  'tutorial.geotech-statistic.body':
    'Before you subdivide, pick the qc statistic each packing class is classified with. It is a per-model choice and part of the model provenance, so the label shows the current token on the toolbar.',
  'tutorial.geotech-correlate.title': 'Correlate packing by hand',
  'tutorial.geotech-correlate.body':
    'Correlate packing connects a packing band to the same class on a neighbour, the geotech twin of the litho Correlate. Click two same-class bands to tie them; right-click a tie to disconnect it.',
  'tutorial.geotech-display.title': 'Geotech view options',
  'tutorial.geotech-display.body':
    'The Display menu toggles what the geotech axis draws: the packing fill, the built-model fill, the litho fill underneath, the borehole preview and the correlation ribbons.',
  'tutorial.geotech-build.title': 'Build the geotech model',
  'tutorial.geotech-build.body':
    'On the Geotech stage, Build model turns the accepted packing bands into 3-D NAD body solids. A pre-flight asks about any test that carries litho but no bands before it builds. This step ticks once the geotech solids exist.',
  'tutorial.geotech-fence.title': 'Export the geotech fence',
  'tutorial.geotech-fence.body':
    'Once the geotech solids exist, Export fence writes the 3-D fence diagram to DXF, the same way the litho stage does. It refuses with a warning unless the view is in Fence mode.',
  'tutorial.geotech-pane.title': 'The units panel',
  'tutorial.geotech-pane.body':
    'The panel lists the units as soil, then NAD packing class, then body, and lets you recolour a row. Click a body to select it on the section; the readout names the class and how its qc was assigned.',
  'tutorial.params-units.title': 'The unit tree',
  'tutorial.params-units.body':
    'The unit tree lists every unit in the finished model. Tick a unit to see its statistics; the counts show how many bodies each one pools.',
  'tutorial.params-group.title': 'Group units',
  'tutorial.params-group.body':
    'Tick units of the same NAD class across bodies, then Join them into one reporting group; Un-join lifts one back out and Clear drops the selection. A group pools its members statistics under one header.',
  'tutorial.params-water-table.title': 'The water table',
  'tutorial.params-water-table.body':
    'The water-table line says which level every normalised value above it was computed under. Click it to set your own depth; the source label shows whether it came from you or a default. Everything here is characterisation, never a design value.',
} as const
