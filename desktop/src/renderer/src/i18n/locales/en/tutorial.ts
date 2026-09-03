// Guided-tutorial copy (debt #93, owner ruling 24; spec
// docs/superpowers/specs/2026-09-02-guided-tutorial-design.md).
//
// Part of the English message catalogue — see 'locales/en/index.ts' for the
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
  'tutorial.chapter.4': 'Geological model',
  'tutorial.chapter.5': 'Lithostratigraphic model',
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
  'tutorial.ui.doItHint': 'Do this in the app — the tutorial moves on by itself when you do.',
  'tutorial.ui.openTab': 'Open the highlighted tab to find this control.',
  'tutorial.ui.offscreen': "The control isn't on screen right now — the tip stays here until it is.",

  // 1 · Your project --------------------------------------------------------
  'tutorial.project-name.title': 'Name your project',
  'tutorial.project-name.body':
    "Every project starts with a name. Use something you'll recognise later — your job number and the site, like GEO-22/040 Brugge. Client, phase and other details can be added afterwards.",
  'tutorial.project-create.title': 'Create the project',
  'tutorial.project-create.body':
    'Click Create project to open it. From here on every CPT, borehole, section and model lives inside this project and is saved with it.',
  'tutorial.project-metadata.title': 'Open the project settings',
  'tutorial.project-metadata.body':
    'Your coordinate system and vertical datum live in the project settings. Click the project name at the top of the window to open them — the same panel where you edit the client, site and tags later.',
  'tutorial.project-crs.title': 'Set the coordinate system',
  'tutorial.project-crs.body':
    'Open the project metadata and choose the horizontal CRS: Lambert 72 (EPSG 31370) for Belgium, RD New (EPSG 28992) for the Netherlands. It must match how your data was surveyed, or every location lands in the wrong place.',
  'tutorial.project-datum.title': 'Set the vertical datum',
  'tutorial.project-datum.body':
    'The vertical datum is the zero that every elevation is measured from — TAW in Belgium, NAP in the Netherlands. Pick the one your levels use so depths and surface heights read correctly across the whole model.',

  // 2 · Import --------------------------------------------------------------
  'tutorial.import-open.title': 'The Import menu',
  'tutorial.import-open.body':
    'This is where data comes in. Open it to see every importer StrixGeo offers today — CPTs and boreholes, from local files or straight from DOV.',
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
    "Not every sounding belongs in your dataset. Remove one to hide it from this project — a reversible, project-local hide you can restore any time. The data itself is never deleted.",
  'tutorial.import-borehole-dov.title': 'Import boreholes from DOV',
  'tutorial.import-borehole-dov.body':
    "Boreholes come in the same way: choose 'Import Borehole from DOV' and draw a box on the map. This step ticks once your first borehole lands.",
  'tutorial.import-gef.title': 'Import local GEF files',
  'tutorial.import-gef.body':
    "Have CPTs on disk? 'Import CPT (.gef)' reads standard GEF files straight from your computer — useful for soundings that are not in DOV.",
  'tutorial.import-more.title': 'More sources are coming',
  'tutorial.import-more.body':
    "DMT, lab tests and monitoring data are on the roadmap — you'll see them marked 'Phase 4' in the menu for now.",
  'tutorial.import-closing.title': 'Need another format?',
  'tutorial.import-closing.body':
    'More importers are coming, depending on what you need — send the file formats you use to StrixGeo and we build the parser.',

  // 3 · Cross-sections ------------------------------------------------------
  'tutorial.section-create.title': 'Create a cross-section',
  'tutorial.section-create.body':
    'A cross-section is where you build and edit all three models. Create your first one — draw the line through the investigations you want to correlate. Once it opens, double-click any column to read that test in full detail. This step ticks once a section exists.',
  'tutorial.section-buffer.title': 'Projection buffer',
  'tutorial.section-buffer.body':
    'The buffer is how far to either side of the section line a test can sit and still be projected onto it. Widen it to catch more soundings, narrow it to keep only the ones right on the line.',
  'tutorial.section-spacing.title': 'Column spacing',
  'tutorial.section-spacing.body':
    'Spacing spreads the projected columns apart so overlapping tests stop hiding each other. At 0% each test sits at its true along-section position; higher values trade that for legibility.',
  'tutorial.section-vexag.title': 'Vertical exaggeration',
  'tutorial.section-vexag.body':
    'Ground is far wider than it is deep, so thin layers vanish at true scale. Vertical exaggeration stretches the depth axis to make them readable — only the drawing is stretched, the numbers stay real.',
  'tutorial.section-channels.title': 'CPT data channels',
  'tutorial.section-channels.body':
    'Toggle the CPT traces — qc, Rf, fs, u2 and qT — to show only the ones you are reading. Fewer channels means a cleaner column when you correlate layers.',
  'tutorial.section-boreholes.title': 'Borehole interpretation streams',
  'tutorial.section-boreholes.body':
    'A borehole can carry several interpretation streams. Toggle Geo (geotechnical coding), F-Strat (formal stratigraphy) and I-Strat (informal stratigraphy) next to the CPT channels — each stream you turn on draws as its own strip beside the borehole. Geo is on by default.',
  'tutorial.section-axis.title': 'Model axis',
  'tutorial.section-axis.body':
    'The same section edits all three levels. Switch the axis between Geology, Litho and Geotech to work on each model in turn without leaving the section.',
  'tutorial.section-snap.title': 'Snap to stratigraphy',
  'tutorial.section-snap.body':
    'With Snap on, a click near a logged boundary lands exactly on it instead of a pixel off. It keeps your contacts tied to the stratigraphy the boreholes actually record.',
  'tutorial.section-dem.title': 'The ground surface',
  'tutorial.section-dem.body':
    'The grey line across the top is the terrain from the DEM, drawn automatically wherever the ground level is known. It is the reference your elevations hang from.',
  'tutorial.section-persist.title': 'Your view is saved',
  'tutorial.section-persist.body':
    'Every setting here — buffer, spacing, exaggeration, channels, snap — saves to this section on its own. Reopen it and the framing is exactly as you left it; Reset returns the default view.',

  // 4 · Geological model ----------------------------------------------------
  'tutorial.geo-open.title': 'Open the Geology stage',
  'tutorial.geo-open.body':
    'The geological model is the backbone of the ground model. It holds the formations and the surfaces between them, the regional layers under your whole site. Build it first, then the litho and geotech models refine it from there.',
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
    'Build the formation surfaces from the contacts. StrixGeo fits one surface through each formation top. Then check the crossings the validator reports, because the formations have to stay in order for the model to be valid.',

  // 5 · Lithostratigraphic model --------------------------------------------
  'tutorial.litho-open.title': 'Open the Lithology stage',
  'tutorial.litho-open.body':
    'The lithostratigraphic model refines the geological backbone into lithological units. Think sand, clay, silt, gravel and peat, with their admixtures. You build it along your cross-sections, one column at a time.',
  'tutorial.litho-create.title': 'Create a lithological model',
  'tutorial.litho-create.body':
    'The litho model is a separate ground-model axis under the geological one. Create it first — until it exists there is nothing to pick litho contacts onto. Give it a name and it becomes the active litho model.',
  'tutorial.litho-axis.title': 'Switch to the litho axis',
  'tutorial.litho-axis.body':
    'Open a cross-section and switch its axis to Litho. The same section now edits the litho model instead of the geology — every suggestion and correlation you make from here belongs to the litho model.',
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
    'As with the geology, a single section carries only one profile. Draw a second cross-section so the litho bodies have the 3-D data to connect between your sections.',
  'tutorial.litho-build.title': 'Build the litho bodies',
  'tutorial.litho-build.body':
    'Build turns the accepted, correlated layers into connected litho bodies in 3-D. Each mass that joins across your sections becomes one body. This step ticks once the litho solids exist.',

  // 6 · Geotechnical model --------------------------------------------------
  'tutorial.geotech-open.title': 'Open the Geotechnics stage',
  'tutorial.geotech-open.body':
    'The geotechnical model subdivides the litho units into NAD packing classes. It reads CPT-derived indicators like qc and relative density, so these are characterisation estimates, not design values. Your design numbers come later, in your design tool.',
  'tutorial.geotech-subdivide.title': 'Run the packing pipeline',
  'tutorial.geotech-subdivide.body':
    'On a cross-section, switch to the Geotech axis and open the packing pipeline. It runs in four steps: subdivide the CPTs so each litho unit splits into its packing classes, propose and accept the packing correlations, then divide the boreholes to carry the classes across. This step ticks once the geotechnical model exists.',
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
  'tutorial.export-dxf.title': 'Export your model',
  'tutorial.export-dxf.body':
    'Export a section to DXF, to Plaxis, to D-Stability or D-Sheet, or to a PDF report sheet. Each export carries your unit identifiers, so the model arrives labelled in the design tool. Pick the format your next step needs.',
  'tutorial.closing.title': "You're all set",
  'tutorial.closing.body':
    'That is the whole workflow: import, section, geology, litho, geotech, parameters, export. Build your first model on your own data. More importers and exporters are coming, so send the file formats you use to StrixGeo and we build them next.',
} as const
