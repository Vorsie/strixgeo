// Guided-tutorial copy (debt #93, owner ruling 24; spec
// docs/superpowers/specs/2026-09-02-guided-tutorial-design.md).
//
// Part of the English message catalogue — see 'locales/en/index.ts' for the
// key-naming rules. Keys are `tutorial.chapter.<n>`, `tutorial.<stepId>.title|body`
// and `tutorial.ui.*` for the coach-card chrome.
//
// Chapters 1-3 carry full drafted copy (2-4 short sentences a step); chapters
// 4-8 carry one-sentence skeleton drafts. ALL wording is a DRAFT for the owner's
// review. Behaviour described here is derived from the real controls, never
// invented (brief: "never invent behaviour"). Product names (StrixGeo, DOV,
// Plaxis, D-Stability, DXF, NAD) stay raw tokens.

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
    'A cross-section is where you build and edit all three models. Create your first one — draw the line through the investigations you want to correlate. This step ticks once a section exists.',
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
  'tutorial.section-boreholes.title': 'Borehole streams',
  'tutorial.section-boreholes.body':
    'Boreholes can show more than one interpretation stream side by side. Turn each on or off — every enabled stream draws as its own strip next to the CPTs.',
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

  // 4 · Geological model (skeleton) -----------------------------------------
  'tutorial.geo-open.title': 'Open the Geology stage',
  'tutorial.geo-open.body': 'The geological model is the backbone — the formations and the surfaces between them.',
  'tutorial.geo-seed.title': 'Seed from boreholes',
  'tutorial.geo-seed.body': "Seed the model's first contacts from your boreholes, reading the formation tops they log.",
  'tutorial.geo-lumping.title': 'Same unit, different name',
  'tutorial.geo-lumping.body': 'Tell the model that two units are the same by lumping the stratigraphy into one formation.',
  'tutorial.geo-surfaces.title': 'Build the surfaces',
  'tutorial.geo-surfaces.body': 'Rebuild the formation surfaces and check where any of them cross.',

  // 5 · Lithostratigraphic model (skeleton) ---------------------------------
  'tutorial.litho-open.title': 'Open the Lithology stage',
  'tutorial.litho-open.body': 'Refine the geological backbone into lithological units along your sections.',
  'tutorial.litho-accept.title': 'Accept the suggestions',
  'tutorial.litho-accept.body': 'The segmenter proposes litho layers on each column; accept the ones that match what you see.',
  'tutorial.litho-build.title': 'Build the litho bodies',
  'tutorial.litho-build.body': 'Build turns the accepted layers into connected 3-D litho bodies.',

  // 6 · Geotechnical model (skeleton) ---------------------------------------
  'tutorial.geotech-open.title': 'Open the Geotechnics stage',
  'tutorial.geotech-open.body': 'Subdivide the litho units into NAD packing classes from CPT-derived indicators.',
  'tutorial.geotech-subdivide.title': 'Run the packing pipeline',
  'tutorial.geotech-subdivide.body': 'Subdivide the CPTs to build the geotechnical model — each unit split into its packing classes.',
  'tutorial.geotech-bodies.title': 'Correlate and recompute',
  'tutorial.geotech-bodies.body': 'Recompute the bodies, then Join or Separate where two masses are (or are not) the same body.',

  // 7 · Parameters & statistics (skeleton) ----------------------------------
  'tutorial.params-open.title': 'Open the Parameters stage',
  'tutorial.params-open.body': 'The unit tree, per-unit statistics and the fence cutout live here.',
  'tutorial.params-stats.title': 'Per-unit statistics',
  'tutorial.params-stats.body': 'Pick a unit to see its statistics pooled across every body that belongs to it.',

  // 8 · Export (skeleton) ---------------------------------------------------
  'tutorial.export-open.title': 'Open the Export stage',
  'tutorial.export-open.body': 'Send the finished three-level model to your design tools.',
  'tutorial.export-dxf.title': 'Export your model',
  'tutorial.export-dxf.body': 'Export a section to DXF, Plaxis, D-Stability / D-Sheet, or a PDF report sheet.',
  'tutorial.closing.title': "You're all set",
  'tutorial.closing.body':
    "That's the whole workflow — import, section, geology, litho, geotech, parameters, export. Build your first model, and tell us what you need next.",
} as const
