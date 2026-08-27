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

  // -------------------------------------------------------------------------
  // export stage.
  // -------------------------------------------------------------------------
  'export.title': 'Exports',
  'export.blurb': 'Hand the ground model off to a downstream design tool.',
  'export.sections': 'Sections',
  'export.geology': 'Geology',
  'export.crossSection': 'Cross-section',
  'export.crossSectionToExport': 'Cross-section to export',
  'export.sectionBlurb':
    "Export one cross-section's layer geometry — DXF (universal CAD exchange) or a runnable Plaxis 2D plxscripting script with one borehole per projected column.",
  'export.geologyPlaxis3d': 'Geological model → Plaxis 3D',
  'export.geologyBlurb':
    'Export the whole model as a runnable plxscripting Python script — one Mohr-Coulomb placeholder soil + one borehole per investigation.',
  'export.noActiveModel': 'No active geological model. Define formations and place contacts first.',
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
} as const
