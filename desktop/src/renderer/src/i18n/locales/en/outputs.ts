// Parameters + Export stages — the two stages that read the model rather
// than build it.
//
// Part of the English message catalogue — see 'locales/en/index.ts' for the
// key-naming rules and the domain-canon carve-out.

export const OUTPUTS = {
  // -------------------------------------------------------------------------
  // parameters stage.
  // -------------------------------------------------------------------------
  'params.title': 'Parameters & analyses',
  'params.views': 'Parameter views',
  'params.perTest': 'Per test',
  'params.perUnit': 'Per unit',
  'params.methods': 'Methods',
  'params.pickTab': 'Pick a tab above.',
  'params.perTestBlurb': 'One row per CPT / borehole / lab test; columns are parameters.',
  'params.perUnitBlurb':
    'One row per litho / geotechnical unit; columns aggregate over the unit (mean / P50 / P95 / derived values).',
  'params.methodsBlurb':
    'Correlations (formula) vs Excel lookups (NAD-NEN table) — hard-separated. Plus probabilistic + ML hooks.',
  'params.correlations': 'Correlations',
  'params.correlationsBlurb':
    'Formula-driven derivations from in-situ measurements. Pick one method per (parameter, unit).',
  'params.excelLookups': 'Excel lookups',
  'params.nadNenTable': 'NAD-NEN table (38 × 313)',
  'params.projectXlsxImport': 'Project-specific xlsx import',
  'params.probabilisticMl': 'Probabilistic + ML',
  'params.probabilisticMlBlurb':
    'Distribution wiring for probabilistic design tools, plus an audit-required ML suggestion surface.',
  'params.probabilisticDistributions': 'Probabilistic distributions',
  'params.mlSuggestion': 'ML / AI suggestion',
  'params.noTestSelected': 'No test selected',
  'params.pickCptRow':
    'Click a CPT row in the per-test table to plot its depth series and soil-behaviour-type profile here.',
  'params.loadingDepthSeries': 'Loading depth series…',
  'params.waterTable': 'Water table:',
  'params.waterTableSet': 'Click to set the water table for this CPT',
  'params.waterTableHint': 'Depth to groundwater in metres below ground surface',
  'params.waterTableEditHint': 'm — Enter to apply, Esc to cancel',
  'params.waterTableUndo':
    "Undo the water table you set — the file's value comes back when the file recorded one, otherwise the app's assumption",
  'params.sbtNormalised': 'Normalised Robertson 2015 SBT zone',
  'params.sbtNonNormalised': 'Non-normalised I_SBT zone (Robertson 2010)',

  // --- Parameters stage — wired from the stage components (P6 coverage) ---
  'params.phase5Surface':
    'Phase-5 surface — design-ready parameters (φ′ / c′ / cu / E50 / OCR / Vs / G0 / M) populate as correlations and lookups land.',
  'params.unknownTab': 'Unknown parameters tab',
  // water-table provenance labels
  'params.gwtRecorded': 'recorded',
  'params.gwtEngineer': 'set by engineer',
  'params.gwtEngineerShort': 'engineer',
  'params.gwtAssumed': 'assumed',
  'params.waterTableInvalid':
    'Water table must be a number in metres — negative if the water is above the surface.',
  'params.waterTableSaveFailedDetail': 'Could not save the water table — {error}',
  'params.waterTableSaveFailed': 'Could not save the water table.',
  'params.cptLoadFailedDetail': 'Could not load this CPT — {error}',
  'params.cptLoadFailed': 'Could not load this CPT.',
  'params.cptFallbackName': 'CPT',
  'params.depthMDeep': '{depth} m deep',
  'params.depthUnknown': 'depth unknown',
  // depth panels
  'params.sbtDerivationNote':
    'SBTn normalised at water table {gwt} m ({source}) · SBT (I_SBT) needs none',
  'params.zoneN': 'zone {n}',
  // per-unit distribution channel row
  'params.channelQc': 'Cone resistance',
  'params.channelFs': 'Sleeve friction',
  'params.channelRf': 'Friction ratio',
  'params.channelAriaLabel':
    '{title} distribution over this unit: median {median} {unit}, {n} samples',
  'params.notRecordedOnCpts': 'Not recorded on the CPTs covering this unit.',
  'params.offAxis': '{count} off axis',
  'params.marksNotDrawn': '{marks} not drawn — spanning off-axis values',
  'params.markWhisker': 'whisker',
  'params.markBox': 'box',
  'params.statMin': 'min',
  'params.statMedian': 'median',
  'params.statMax': 'max',
  'params.statMean': 'mean',
  'params.statSd': 'sd',
  // per-unit distribution panel
  'params.standardCptAxes': 'Standard CPT axes',
  'params.fitAxesToData': 'Fit axes to data',
  'params.pooledAxes': 'Pooled axes',
  'params.bandsOfTotal': '{n} of {total} bands',
  'params.bandCountOne': '{n} band',
  'params.bandCountMany': '{n} bands',
  'params.onNCpt': 'on {n} CPT',
  'params.onNCpts': 'on {n} CPTs',
  'params.mOfGround': ' · {thickness} m of ground',
  'params.withoutSeries': ' · {count} without series',
  'params.noConeInBody': 'No cone measurements in this body',
  'params.noConeInUnit': 'No cone measurements in this unit',
  'params.noConeBodyHint':
    'This body has no bands on a CPT — a borehole-only body carries no cone resistance to summarise.',
  'params.noConeUnitHint':
    'This unit has no bands on a CPT — a borehole-only unit carries no cone resistance to summarise.',
  'params.noConeBandsHint': 'The bands are there, but no CPT series covers them yet.',
  'params.characterisationNote':
    "Characterisation only — the spread of the measurements inside this unit's bands. These are not design parameters; φ′, c′, cu, E50, OCR and Vs are not derived here.",
  // fence cutout
  'params.whereUnitSits': 'Where this unit sits',
  'params.fenceCutoutBlurb':
    "The fence diagram cut down to the selected unit's walls over the basemap — a visual anchor, not an editor.",
  'params.loading3dView': 'Loading the 3D view…',
  'params.kindGeotech': 'geotechnical',
  'params.kindLitho': 'lithological',
  'params.noModelYet': 'No {kind} model yet — the fence cutout appears once one exists.',
  'params.assemblingFence': 'Assembling the fence…',
  'params.noFenceWalls':
    'No fence walls for this unit yet — connect its bands across sections and they will appear here.',
  'params.resetCameraFrame': 'Reset the camera to frame the model',
  // identification tests
  'params.identificationTests': 'Identification tests',
  'params.labTestsLoadFailedDetail': 'Could not load the lab tests for this unit — {error}',
  'params.labTestsLoadFailed': 'Could not load the lab tests for this unit.',
  'params.okpBlurb':
    "Classification lab results (OKP) on the unit's borehole samples — value against elevation.",
  'params.samplesSkippedOne': ' {n} sample skipped — collar elevation unknown.',
  'params.samplesSkippedMany': ' {n} samples skipped — collar elevation unknown.',
  'params.loadingIdentificationTests': 'Loading identification tests…',
  'params.noIdentificationTests': 'No identification tests in this unit.',
  'params.sampleSuffix': ' · sample {n}',
  'params.idDotTooltip': '{value} {unit} · {elevation} mTAW · {borehole}{sample}',
  'params.idPanelAriaLabel': '{label}: {n} samples against elevation',
  // PSD panel
  'params.grainSizeDistributions': 'Grain-size distributions',
  'params.percentPassingParen': '(% passing)',
  'params.curveCountOne': '{n} curve',
  'params.curveCountMany': '{n} curves',
  'params.psdSkipped': '{n} skipped (fewer than 2 sieve points)',
  'params.passingPct': 'Passing (%)',
  'params.psdAriaLabel': 'Grain-size distributions: {n} curves, % passing against diameter',
  'params.diameterMm': 'Diameter (mm)',
  'params.grainSizeCurveActions': 'Grain-size curve actions',
  'params.showSampleOnSection': 'Show sample on cross-section',
  // unit list pane
  'params.loadingUnitRoster': 'Loading the unit roster…',
  'params.noUnitsYet': 'No units yet',
  'params.noUnitsHintTree':
    'Build a lithological model on the Lithology stage, then subdivide it on the Geotechnical stage — the tree will populate here.',
  'params.unitsHeader': 'Units',
  'params.orphanBandsOne': '{n} band outside the litho model',
  'params.orphanBandsMany': '{n} bands outside the litho model',
  'params.phase5NoteUnitList':
    'φ′ · c′ · cu · E50 — design parameters populate in Phase 5, when the correlation + NAD-NEN lookup pipeline lands.',
  'params.nodeBandsOne': '{n} band · {cone} with cone',
  'params.nodeBandsMany': '{n} bands · {cone} with cone',
  // Right-pane grouping (owner finding 2026-09-03) — the bulk bar + toasts.
  // Reuses the section-canvas body-union verb; a group is a label over distinct
  // bodies ("Join = GROUP, never MERGE"), so the undo path is Ungroup.
  'params.groupNSelected': '{n} selected',
  'params.group': 'Group',
  'params.ungroup': 'Ungroup',
  'params.clearSelection': 'Clear',
  'params.groupCheckboxAria': 'Select {label} to group',
  'params.groupCheckboxAriaWithParent': 'Select {label} ({parent}) to group',
  'params.checkedInside': '{n} checked inside',
  'params.groupNeedTwoHint': 'Select at least two bodies to group.',
  'params.groupCrossClassHint': 'Only bodies of the same packing class can be grouped.',
  'params.groupCrossClassHintNamed':
    'Only bodies of the same packing class can be grouped — you selected {classes}.',
  'params.grouped': 'Grouped — select a member and press Ungroup to undo.',
  'params.ungrouped': 'Ungrouped — the body stands on its own again.',
  'params.groupFailed': 'Could not group the bodies.',
  'params.ungroupFailed': 'Could not ungroup the body.',
  // unit statistics canvas
  'params.unitNoLongerExists': 'This unit no longer exists',
  'params.unitNoLongerExistsHint':
    'It was removed or rebuilt since it was selected — pick another unit in the list.',
  'params.lithostratigraphicUnit': 'Lithological unit',
  'params.geotechnicalUnit': 'Geotechnical unit',
  // NAD characteristic values block (owner ruling 2026-09-05) — a per-body read
  // of the NAD table, shown separately from the per-unit statistics.
  'params.nadValuesTitle': 'NAD characteristic values',
  'params.nadProvenance':
    'NBN EN 1997-1 ANB Tabel 2.1, characteristic values for class {n} ({name})',
  'params.nadCaveat': 'Characteristic values from the NAD table, not design values.',
  'params.nadDryUnitWeight': 'dry unit weight',
  'params.nadWetUnitWeight': 'wet unit weight',
  'params.nadFrictionAngle': 'friction angle',
  'params.nadCohesion': 'cohesion',
  'params.nadUndrainedShear': 'undrained shear strength',
  'params.closeUnitStats': 'Close the unit statistics',
  'params.loadingMeasurements': 'Loading measurements…',
  'params.populationNote':
    'n = {qcN} qc samples over {cptCount} {cptWord} on {sectionCount} {sectionWord} — only tests on sections pool; hidden and removed are excluded',
  'params.cptWordSingular': 'CPT',
  'params.cptWordPlural': 'CPTs',
  'params.sectionWordSingular': 'section',
  'params.sectionWordPlural': 'sections',
  // per-test tab
  'params.noTestsYet': 'No tests yet',
  'params.noTestsHint':
    "Import CPTs / boreholes on the Data stage. They'll appear here once the project has investigations.",
  'params.colKind': 'Kind',
  'params.colDepthM': 'Depth (m)',
  'params.colIcBar': 'Ic̄ (Robertson 2015)',
  'params.testCountOne': '{n} test',
  'params.testCountMany': '{n} tests',
  'params.perTestFooterRest':
    " · click a CPT row to plot its depth series and soil-behaviour-type profile in the inspector on the right. Ic̄ appears once that CPT's series has been loaded.",
  'params.designReadyParam':
    'Design-ready parameter — populated in Phase 5 when the correlation / xlsx pipeline lands.',
  // per-unit tab
  'params.noUnitsHintStats':
    'Build a lithological model on the Lithology stage, then subdivide it on the Geotechnical stage — the units will populate here with their statistics.',
  'params.pickUnit': 'Pick a unit',
  'params.pickUnitHint':
    'Click a unit in the list on the right — its qc / fs / Rf statistics draw here. Right-clicking a band in a cross-section jumps here too.',
  // methods tab
  'params.excelLookupsSubtitle':
    'Table-driven values from owner-curated or project-imported spreadsheets. Hard-separated from correlations — the engineer picks ONE path per cell.',
  'params.methodRobertsonWride': 'Robertson & Wride 1986',
  'params.methodMayne': 'Mayne 2007',
  'params.methodKulhawyMayne': 'Kulhawy & Mayne 2014',
  'params.methodUzielli': 'Uzielli 2013',
  'params.methodRobertson2015': 'Robertson 2015 / 2009',
  'params.methodRefRobertsonWride': 'φ′ from Qtn — Robertson, P.K. & Wride, C.E. (1998)',
  'params.methodRefMayne': 'φ′ from Qtn — Mayne, P.W. (2007)',
  'params.methodRefKulhawyMayne': 'OCR from Qt — Kulhawy & Mayne (2014)',
  'params.methodRefUzielli': 'φ′ probabilistic — Uzielli (2013)',
  'params.methodRefRobertson2015': 'SBT zone + Ic — Robertson (2015), zone map (2009)',
  'params.methodRefNadNen': 'Owner-curated; per NAD class × parameter lookup',
  'params.methodRefXlsx': 'User-provided; loaded once per project',
  'params.methodRefProbabilistic': 'Per-parameter μ ± σ + distribution type (Normal / Lognormal / Beta)',
  'params.methodRefMl': 'Audit-required surface (never auto-applies — owner directive)',
  'params.methodAppliesRobertsonWride': 'Sand units (Ic < 2.6); inputs qc, fs',
  'params.methodAppliesMayne': 'Sand units; inputs qc, σ′v',
  'params.methodAppliesKulhawyMayne': 'Clay units (Ic > 2.6); inputs qc, σv, σ′v',
  'params.methodAppliesUzielli': 'Sand units; emits μ + σ rather than a scalar',
  'params.methodAppliesRobertson2015': 'All units; segmenter already uses this path (port complete)',
  'params.methodAppliesNadNen': 'Sand + fines NAD classes 1–31; primary v1.0 lookup source',
  'params.methodAppliesXlsx': 'Overrides the NAD-NEN defaults when the engineer ships their own table',
  'params.methodAppliesProbabilistic':
    'Downstream probabilistic design (D-Stability Probabilistic Toolkit, Plaxis statistics export)',
  'params.methodAppliesMl':
    'Side-by-side comparison vs correlation / xlsx choice; flagged when the prediction diverges',
  'params.phase5Placeholder': 'Phase 5 placeholder',
  'params.methodsStatusPre': 'Status: all cards above are ',
  'params.methodsStatusBold': 'structural skeletons',
  'params.methodsStatusPost':
    ' for Phase 5. Surfacing the three-pillar architecture today keeps the design decisions visible — push back on the shape (which methods, which xlsx sources, the hard-separation rule) BEFORE the Phase-5 implementation budget commits.',

  // -------------------------------------------------------------------------
  // export stage.
  // -------------------------------------------------------------------------
  'export.title': 'Exports',
  'export.blurb': 'Hand the ground model off to a downstream design tool.',
  'export.sections': 'Sections',
  'export.geology': 'Stratigraphy',
  'export.crossSection': 'Cross-section',
  'export.crossSectionToExport': 'Cross-section to export',
  'export.sectionBlurb':
    "Export one cross-section's layer geometry — DXF (universal CAD exchange) or a runnable Plaxis 2D plxscripting script with one borehole per projected column.",
  'export.geologyPlaxis3d': 'Stratigraphic model → Plaxis 3D',
  'export.geologyBlurb':
    'Export the whole model as a runnable plxscripting Python script — one Mohr-Coulomb placeholder soil + one borehole per investigation.',
  'export.noActiveModel': 'No active stratigraphic model. Define formations and place contacts first.',
  'export.dxf': 'AutoCAD DXF',
  'export.pythonScript': 'Python script',
  'export.allFiles': 'All Files',
  'export.gefFiles': 'GEF Files',
  'export.dStability': 'D-Stability (.stix)',
  'export.dSheetPiling': 'D-Sheet Piling (.shi)',
  'export.dxfFailed': 'Could not export the DXF.',
  'export.pdfFailed': 'Could not export the PDF.',
  'export.plaxisFailed': 'Could not export the Plaxis script.',
  'export.fenceFailed': 'Could not export the fence diagram.',
  'export.reportEngineer': 'Engineer name',
  'export.reportGenerate': 'Generate section PDF',
  'export.reportNotes': 'Optional free-text description rendered under the metadata table.',
  'export.reportBlurb':
    'Customise the title and metadata that appear on the report’s header. All fields are optional — leave the title default for the section name.',
  'export.reportTitleLabel': 'Title',
  'export.reportAuthorLabel': 'Author',
  'export.reportNotesLabel': 'Notes',
  'export.reportGenerating': 'Generating…',
  'export.reportGeneratePdf': 'Generate PDF',

  // --- export stage canvas + fence DXF + shared 3D view (P6 coverage) ---
  'export.heading': 'Export',
  'export.canvasBlurb':
    'Hand the ground model off to a downstream design tool. Layer geometry is the integration unit — per-layer parameters are set in the destination tool.',
  'export.guidanceNoModelPre':
    'No active stratigraphic model. Define formations and place contacts in the ',
  'export.guidanceNoModelPost': ' stage first.',
  'export.guidanceNoSectionsPre': 'No cross-sections yet. Create one in the ',
  'export.guidanceNoSectionsPost': ' stage.',
  'export.exporting': 'Exporting…',
  'export.exportDxf': 'Export DXF',
  'export.exportPlaxis2d': 'Export Plaxis 2D',
  'export.exportPlaxis3d': 'Export Plaxis 3D',
  'export.fenceNothingToExport':
    'Nothing to export: switch the 3-D view to Fence and make sure the fence has walls.',
  'export.fenceExported': 'Fence diagram exported — {count} panels.',
  'export.fenceIncompleteOne':
    '{n} cross-section could not load its correlations — the fence is incomplete and shows those panels untied: {names}. Reopen Fence view to retry.',
  'export.fenceIncompleteMany':
    '{n} cross-sections could not load their correlations — the fence is incomplete and shows those panels untied: {names}. Reopen Fence view to retry.',
  'export.viewLabel': 'View',
  'export.viewSolid': 'Solid',
  'export.viewFence': 'Fence',
  'export.viewWireframe': 'Wireframe',
  'export.viewWireframeTitle': 'Show the body model as wireframe',

  // --- Export hub (installer #35, the Export stage is the only export surface) ---
  'export.hubBlurb':
    'Every export lives here. Pick a cross-section, then export it to the tool you need. Fence diagrams and the 3-D model export from their own cards below.',
  'export.crossSectionPickerLabel': 'Cross-section to export',
  'export.axisLabel': 'Model level',
  'export.axisGeological': 'Stratigraphy',
  'export.axisLithological': 'Lithology',
  'export.axisGeotechnical': 'Geotechnical',
  'export.groupCrossSection': 'Cross-section',
  'export.groupStratigraphy': 'Stratigraphy',
  'export.groupLithology': 'Lithology',
  'export.groupGeotechnical': 'Geotechnical',
  'export.groupReport': 'Report',
  'export.cardSectionDxfTitle': 'Cross-section DXF',
  'export.cardSectionDxfDesc':
    "One cross-section's layer geometry as an AutoCAD DXF, on the model level you choose.",
  'export.cardPlaxis3dTitle': 'Stratigraphic model → Plaxis 3D',
  'export.cardPlaxis3dDesc':
    'The whole model as a runnable plxscripting script: one placeholder soil + one borehole per investigation.',
  'export.cardLithoFenceTitle': 'Fence diagram (DXF)',
  'export.cardLithoFenceDesc':
    'The lithological 3-D fence walls as a DXF: one layer per section by unit.',
  'export.cardGeotechDstabilityDesc':
    'The geotechnical cross-section as closed D-Stability polygons (geometry only, no design parameters).',
  'export.cardGeotechDsheetDesc':
    'A 1-D soil profile through the geotechnical cross-section as a D-Sheet .shi (geometry only).',
  'export.cardGeotechPlaxis2dTitle': 'Plaxis 2D (packing classes)',
  'export.cardGeotechPlaxis2dDesc':
    'The geotechnical cross-section, with NAD packing classes, as a Plaxis 2D script.',
  'export.cardGeotechFenceTitle': 'Fence diagram (DXF)',
  'export.cardGeotechFenceDesc':
    'The geotechnical 3-D fence walls as a DXF, coloured by NAD packing class.',
  'export.cardPdfTitle': 'PDF report sheet',
  'export.cardPdfDesc': 'An A3 drawing sheet of the cross-section: preview it, then print to PDF.',
  'export.exportFence': 'Export fence',
  'export.exportStix': 'Export .stix',
  'export.exportShi': 'Export .shi',
  'export.openPreview': 'Open preview',
  'export.lastSaved': 'Last saved: {path}',
  'export.guideNoStratModel':
    'No stratigraphic model yet: build formations and contacts on the Stratigraphy stage first.',
  'export.guideNoLithoModel':
    'No lithological model yet: create and build one on the Lithology stage first.',
  'export.guideNoGeotechModel':
    'No geotechnical model yet: subdivide the lithological units on the Geotechnical stage first.',
  'export.guideNoSections': 'No cross-sections yet: draw one on the Sections stage first.',
  'export.guidePickSection': 'Pick a cross-section above to export it.',
} as const
