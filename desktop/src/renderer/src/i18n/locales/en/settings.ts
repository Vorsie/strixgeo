// Settings dialog. WIRED: SettingsDialog reads these keys today.
//
// Part of the English message catalogue — see 'locales/en/index.ts' for the
// key-naming rules and the domain-canon carve-out.

export const SETTINGS = {
  // -------------------------------------------------------------------------
  // settings — WIRED (SettingsDialog).
  // -------------------------------------------------------------------------
  'settings.title': 'Settings',
  'settings.section.litho': 'Litho segmenter',
  'settings.section.geotech': 'Geotechnical',
  'settings.section.sections': 'Cross-sections',
  'settings.section.appearance': 'Appearance',
  'settings.scope.project': 'Stored in this project',
  'settings.scope.device': 'Stored on this device',
  'settings.needProject': 'Open or create a project to change these settings.',
  'settings.resetDefaults': 'Reset to defaults',
  'settings.sliderLabel': '{label} slider',

  'settings.litho.blurb':
    'Tuning for the Suggest verb on the Litho axis. Applies to the next Suggest call; already-accepted units are unchanged.',
  'settings.litho.minThickness': 'Minimum layer thickness (m)',
  'settings.litho.minThicknessHint':
    'Layers thinner than this are merged into their neighbour, regardless of lithology. Lower values catch thin clay drapes; higher values produce a coarser column. Composes with the "Merge same-lithology layers" toggle below — thickness merging runs first, then same-lithology merging. Default {default} m.',
  'settings.litho.gunsat': 'Soil unit weight above water (kN/m³)',
  'settings.litho.gunsatHint':
    "Used to compute σ'v above the water table, which feeds the Robertson Ic and sand Dr. Site-wide for now: peat ~12, sand ~18, dense Quaternary ~19. Per-soil γ is a future enhancement. Default {default}.",
  'settings.litho.drFactor': 'Sand Dr compression factor',
  'settings.litho.drFactorHint':
    'Jamiolkowski compression factor in the relative-density correlation. 0.675 = average quartz; lower for calcareous sands, higher for crushable feldspar. Most engineers leave this alone. Default {default}.',
  'settings.litho.mergeSameLithology': 'Merge same-lithology layers',
  'settings.litho.mergeSameLithologyHint':
    'Adjacent splits that share lithology (sand-on-sand, etc.) are absorbed into one. Packing-density splits will return as suggestions in the Geotech stage when it ships.',
  'settings.litho.normaliseQc': 'Normalise qc (Robertson 2015)',
  'settings.litho.normaliseQcHint':
    'On (default): classify CPTs with the stress-normalised Robertson 2015 pipeline (Qtn / F / Ic), using the unit weight + water table above. Off: use the non-normalised Robertson 2010 I_SBT index (qc/pa + Rf) — no stress profile or groundwater needed, better at shallow depth or when the water table is uncertain. Off-mode leaves Dr / NAD packing blank (relative density needs effective stress). CPT path only.',
  'settings.litho.fillAtSectionLine': 'Section fill at section line',
  'settings.litho.fillAtSectionLineHint':
    'On = slice the body solids at the section line (default, continuous); Off = sample the model at each test location (a strip per test, ground truth).',
  'settings.litho.snapTolerance': 'Litho↔stratigraphy snap (m)',
  'settings.litho.snapToleranceHint':
    'Litho and stratigraphic boundaries within this distance are treated as the same surface — linked and snapped together, so moving one moves the other (#162). Also drives the drag-snap prompt (#134). Range 0.01–5.0 m.',
  'settings.litho.autoCorrelateWindow': 'Auto-correlate depth window (m)',
  'settings.litho.autoCorrelateWindowHint':
    'How far apart in depth two contacts on neighbouring tests may be and still auto-correlate (relaxed further by horizontal distance). Widen it to catch correlations across dipping beds; narrow it to reject loose matches. Auto-correlate only ever links adjacent tests, never across an intervening one. Range {min}–{max} m. Default {default} m.',
  'settings.litho.openExtentLength': 'Open extent length (m)',
  'settings.litho.openExtentLengthHint':
    'How far an open-ended body extent (a body at the edge test with no neighbour on that side) draws past the test, instead of running to the section edge. Range {min}–{max} m. Default {default} m.',
  'settings.litho.voxelHeading': 'Voxel size',
  'settings.litho.voxelBlurb':
    'Cell dimensions used by the Lithology stage "Build model" button to label 3-D space from the cross-section partitions.',
  'settings.litho.voxelHorizontal': 'Horizontal cell (X/Y) (m)',
  'settings.litho.voxelHorizontalHint':
    'Map-plane (easting/northing) voxel size. Stratigraphy varies slowly horizontally, so this can stay coarse. Smaller values sharpen lateral body edges at a quadratic cost in voxel count. Range {min}–{max} m. Default {default} m.',
  'settings.litho.voxelVertical': 'Vertical cell (Z) (m)',
  'settings.litho.voxelVerticalHint':
    'Elevation voxel size. Fine Z catches thin layers — a peat drape or sand lens — that a coarse grid would miss. But it multiplies build time: 0.5 m is roughly 4× the voxels (and minutes of build) versus a cubic 2 m grid, so reach for it only when thin layers matter. Range {min}–{max} m. Default {default} m.',
  'settings.geotech.blurb':
    'Tuning for the NAD packing subdivision ("Subdivide all bodies"). Applies to the next Subdivide call; already-subdivided bodies are unchanged.',
  'settings.geotech.minThickness': 'Min layer thickness (m)',
  'settings.geotech.minThicknessHint':
    'The thinnest NAD packing band kept; also the persistence a qc change must hold to move a boundary (ignores thinner dips/spikes). Range {min}–{max} m. Default {default} m.',
  'settings.geotech.gradientSnap': 'Gradient snap',
  'settings.geotech.gradientSnapHint':
    'Snap a boundary to a nearby sharp qc break for precision; never moves it to a less-conservative depth.',
  'settings.geotech.gradientSnapWindow': 'Gradient snap window (m)',
  'settings.geotech.gradientSnapWindowHint':
    'How far a boundary may snap to a sharp break. Range {min}–{max} m. Default {default} m.',

  'settings.sections.blurb':
    'Defaults applied when you draw a new cross-section. Existing sections keep whatever they were created with — change those on the section header.',
  'settings.sections.buffer': 'Default projection buffer (m)',
  'settings.sections.bufferHint':
    'Half-width of the corridor around the section line; investigations within ±buffer get projected onto the section. Tight foundation footprints ~15 m, harbour studies 50-100 m. Default {default} m.',
  'settings.sections.vex': 'Default vertical exaggeration',
  'settings.sections.vexHint':
    'Vertical-to-horizontal scale ratio. 1× is geometrically honest; 2-5× makes thin layers legible at regional scale. Default {default}×.',
  'settings.sections.tieTolerance': 'Tie-section strike tolerance (m)',
  'settings.sections.tieToleranceHint':
    'How far apart along-strike two tests may be and still join the same auto-proposed tie-section. Wider = more ties, but less clean.',

  'settings.appearance.blurb':
    'Per-device preferences. These stay on this machine and do NOT travel with the .strix bundle.',
  'settings.appearance.theme': 'Theme',
  'settings.appearance.themeSystem': 'System (follow OS)',
  'settings.appearance.themeLight': 'Light',
  'settings.appearance.themeDark': 'Dark',
  'settings.appearance.themeHint':
    'System follows the OS preference and updates live when you flip Windows/macOS dark mode. Override here to pin the theme.',
  'settings.appearance.language': 'Interface language',
  'settings.appearance.languageHint':
    'Applies immediately, everywhere in the app. Field data keeps the wording of its source — soil names, NAD packing classes and DOV codes are shown as recorded, in every language.',
} as const
