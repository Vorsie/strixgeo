// Data stage — the import verbs and the map/chart canvas. WIRED: DataToolbar
// reads these keys today.
//
// Part of the English message catalogue — see 'locales/en/index.ts' for the
// key-naming rules and the domain-canon carve-out.

export const DATA = {
  // -------------------------------------------------------------------------
  // data stage — WIRED (DataToolbar). Import verbs + canvas tabs.
  // -------------------------------------------------------------------------
  'data.toolbar.import': 'Import',
  'data.toolbar.drawingBbox': 'Drawing bbox…',
  'data.toolbar.menuLabel': '{label} actions',
  'data.toolbar.importCptGef': 'Import CPT (.gef)',
  'data.toolbar.importCptDov': 'Import CPT from DOV (draw bbox)',
  'data.toolbar.importBoreholeDov': 'Import Borehole from DOV (draw bbox)',
  'data.toolbar.importDmt': 'Import DMT',
  'data.toolbar.importLabTest': 'Import Lab Test',
  'data.toolbar.importMonitoring': 'Import Monitoring',
  'data.toolbar.phaseTag': 'Phase 4',
  'data.canvas.map': 'Map',
  'data.canvas.chart': 'Chart',
  'data.canvas.loadingChart': 'Loading chart…',
  'data.canvas.loadingBorehole': 'Loading borehole…',
  'data.import.status': 'DOV import status',
  'data.import.imported': 'Imported',
  'data.import.alreadyExisted': 'Already existed',
  'data.import.failed': 'Failed',
  'data.import.samplesAttached': 'Samples attached',
  'data.import.observationsAttached': 'Observations attached',
  'data.import.streamClosed': 'Import stream closed unexpectedly',

  // -------------------------------------------------------------------------
  // data canvas — DOV import status panel (DataCanvas). The map/chart tab and
  // loading labels above are reused; these are the panel header + close.
  // -------------------------------------------------------------------------
  'data.import.importingCpts': 'Importing CPTs from DOV…',
  'data.import.importingBoreholes': 'Importing boreholes from DOV…',
  'data.import.complete': 'Import complete',
  'data.import.importFailed': 'Import failed',

  // -------------------------------------------------------------------------
  // import result toasts (useInvestigationData) — GEF file import + DOV bbox
  // import. Each toast is composed from these count fragments joined with ", ".
  // -------------------------------------------------------------------------
  'data.import.countImported': '{n} imported',
  'data.import.importedWithWarnings': '{ok} imported ({warnings} with warnings)',
  'data.import.countAlreadyExisted': '{n} already existed',
  'data.import.countFailed': '{n} failed',
  'data.import.refreshedOne': 'Refreshed existing CPT {name} from file',
  'data.import.refreshedMany': '{n} refreshed from file',
  'data.import.leftUnchangedOne': '{name} left unchanged',
  'data.import.leftUnchangedMany': '{n} left unchanged',
  'data.import.noCptsInArea': 'No CPTs found in this area',
  'data.import.noBoreholesInArea': 'No boreholes found in this area',
  'data.import.countObs': '{n} obs',
  'data.import.countSamples': '{n} samples',
  'data.import.countGrainSize': '{n} grain-size',
  'data.import.subPhaseMissing': ' — DOV did not return {items}',
  'data.import.subPhaseRetry': '; re-run the import to retry',
  // Local DOV bbox-draw refusals (useInvestigationData) — a degenerate box (a
  // click without a drag) or an oversized one is caught before the request, so
  // the engineer never sees an opaque "HTTP 422".
  'data.import.drawABox': 'Draw a box over the map to import.',
  'data.import.bboxTooLarge': 'That area is too large. Draw a smaller box (up to 25 km across).',

  // -------------------------------------------------------------------------
  // data load-failure toasts (useInvestigationData).
  // -------------------------------------------------------------------------
  'data.load.cptListFailed': 'Failed to load CPT list',
  'data.load.boreholeListFailed': 'Failed to load borehole list',
  'data.load.chartFailed': 'Failed to load chart data',
  'data.load.boreholeDetailFailed': 'Failed to load borehole detail',

  // -------------------------------------------------------------------------
  // map overlay-persistence failure toasts (useMapOverlays).
  // -------------------------------------------------------------------------
  'data.overlay.saveTerrainFailed': 'Could not save the terrain overlay setting.',
  'data.overlay.saveConfidenceFadeFailed': 'Could not save the confidence-fade setting.',
  'data.overlay.saveVirtueleBoringFailed': 'Could not save the virtuele-boring overlay setting.',

  // -------------------------------------------------------------------------
  // data inspector — search, bulk-action bar, empty states, count footer,
  // sort UI, row tooltips, date-range filter (DataInspector).
  // -------------------------------------------------------------------------
  'data.inspector.searchCpts': 'Search CPTs…',
  'data.inspector.searchBoreholes': 'Search boreholes…',
  'data.inspector.clearSearch': 'Clear search',
  'data.inspector.selectedCount': '{n} selected',
  // Clears the SELECTION. Named "Clear selection" / "Wis selectie" so a bare
  // "Clear"/"Wissen" never reads like delete next to "Remove"/"Verwijderen"
  // (owner ruling 5, 2026-09-06; ruling 10, 2026-09-05).
  'data.inspector.clear': 'Clear selection',
  // The clear-filter action in the date-range filter. A separate key from
  // `clear` so the two clears never collide in one row.
  'data.inspector.clearFilter': 'Clear filter',
  'data.inspector.selectAll': 'Select all',
  'data.inspector.selectAllInTab': 'Select all in this tab',
  'data.inspector.allCptsRemoved': 'All CPTs removed',
  'data.inspector.noCptsImported': 'No CPTs imported yet',
  'data.inspector.noMatches': 'No matches for this search',
  'data.inspector.noCptsVisible': 'No CPTs visible',
  'data.inspector.allBoreholesRemoved': 'All boreholes removed',
  'data.inspector.noBoreholesImported': 'No boreholes imported yet',
  'data.inspector.noBoreholesVisible': 'No boreholes visible',
  // Count-footer noun words, selected by the count (one/many). Composed with
  // the count keys below so Dutch pluralises on its own.
  'data.inspector.cptWordOne': 'CPT',
  'data.inspector.cptWordMany': 'CPTs',
  'data.inspector.countOfTotal': '{shown} of {total} {noun}',
  'data.inspector.count': '{n} {noun}',
  'data.inspector.removedRestoreAll': '{n} removed · restore all',
  'data.inspector.restoreRemovedTitle': 'Restore items removed from this project',
  'data.inspector.sortLabel': 'Sort:',
  'data.inspector.sortDefault': 'Default',
  'data.inspector.sortDate': 'Date',
  'data.inspector.directionAsc': 'Direction: ascending',
  'data.inspector.directionDesc': 'Direction: descending',
  'data.inspector.hiddenCount': 'Hidden ({n})',
  'data.inspector.importedSinceSave': 'Imported since last save — File → Save to commit',
  'data.inspector.noSurfaceElevation': 'No surface elevation — needs manual Z entry',
  'data.inspector.removeFromProject': 'Remove from project',
  'data.inspector.dateRange': 'Date range',
  'data.inspector.clearDateFilter': 'Clear date filter',
  'data.inspector.fromDate': 'From date',
  'data.inspector.toDate': 'To date',

  // -------------------------------------------------------------------------
  // map view (MapView) — strings NOT already covered by the shared map.* keys
  // in panels.ts. (map.basemap / map.terrain / map.opacity / map.borehole /
  // map.boreholeType / map.noValuesForAxis / map.visibleOnMap / map.editMetadata /
  // map.drawSectionLine and elevation.cancelEsc / borelog.drillMethod are reused.)
  // -------------------------------------------------------------------------
  'data.map.pending': 'Pending: {name}',
  // Offline notice on the 2D map (audit L9) — the basemap tiles need network.
  'data.map.offline': 'Offline — map tiles unavailable',
  'data.map.pendingCptLocationsOne': '{n} CPT location pending import',
  'data.map.pendingCptLocationsMany': '{n} CPT locations pending import',
  'data.map.noMarkersToFit': 'No visible markers to fit',
  'data.map.fitToDataOne': 'Fit map to {n} visible item',
  'data.map.fitToDataMany': 'Fit map to {n} visible items',
  'data.map.categoryCpt': 'CPT',
  // The "no hillshade DEM for this CRS" hint is composed around styled <span>s
  // (the CRS label, two EPSG codes, the Edit-metadata link), so it is split
  // into the text chunks between those spans. Dutch reorders "Set … to …" into
  // the separable "Stel … in op …", carried by the intro + noHillshadeTo chunks.
  'data.map.noHillshadeIntro': 'No hillshade source for this CRS. Set',
  'data.map.noHillshadeTo': 'to',
  'data.map.noHillshadeBelgiumOr': '(Belgium) or',
  'data.map.noHillshadeNetherlandsIn': '(Netherlands) in',
} as const
