// Detail panels and dialogs that are reachable from more than one stage —
// map, borehole log, lab tests, elevation editor, composition + formation
// pickers, shared confirm dialogs, undo labels, cheatsheet.
//
// Part of the English message catalogue — see 'locales/en/index.ts' for the
// key-naming rules and the domain-canon carve-out.

export const PANELS = {
  // -------------------------------------------------------------------------
  // map.
  // -------------------------------------------------------------------------
  'map.basemap': 'Basemap',
  'map.terrain': 'Terrain',
  'map.opacity': 'Opacity',
  'map.visibleOnMap': 'Visible on map',
  'map.boreholeType': 'Borehole type',
  'map.borehole': 'Borehole',
  'map.editMetadata': 'Edit metadata',
  'map.drawSectionLine': 'Click two points on the map to draw the cross-section line',
  'map.noValuesForAxis': 'No values for this axis.',
  // DOV import progress panel (rendered in the bbox-import modal while the
  // SSE stream runs).
  'map.cptImportProgress': 'CPT import progress',
  'map.boreholeImportProgress': 'Borehole import progress',
  'map.importProgressOf': '{label} {done} of {total}',
  'map.importFinishedWithErrors': 'Import finished with errors',
  'map.importComplete': 'Import complete',
  'map.imported': 'Imported',
  'map.alreadyExisted': 'Already existed',
  'map.failed': 'Failed',
  'map.cptsInProjectOne': '{n} CPT in project',
  'map.cptsInProjectMany': '{n} CPTs in project',
  'map.observationsAttached': 'Observations attached',
  'map.samplesAttached': 'Samples attached',
  'map.subPhaseFailed': '{label} failed',
  'map.dovMissingData': 'DOV did not return this data. The boreholes are imported, but',
  'map.dovMissingRetry': ' re-run the import over the same area to retry the missing parts.',
  'map.dovMissingNoRetry':
    ' DOV’s catalogue lists these and its own service returns nothing; re-running will not help. Check the boreholes on dov.vlaanderen.be.',
  'map.importFailed': 'Import failed',

  // -------------------------------------------------------------------------
  // borelog + CPT chart.
  // -------------------------------------------------------------------------
  'borelog.boring': 'Boring',
  'borelog.date': 'Date',
  'borelog.executor': 'Executor',
  'borelog.method': 'Method',
  'borelog.waterAt': 'Water at',
  'borelog.drillMethod': 'Drill method',
  'borelog.fieldLog': 'Field log',
  'borelog.stratigraphy': 'Stratigraphy',
  'borelog.lithologyCodes': 'Lithology codes',
  'borelog.labTests': 'Lab tests',
  'borelog.clickSampleToView': 'click sample to view',
  'borelog.samplesAndLabTests': 'Samples + lab tests',
  'borelog.sampleCountOne': '{n} sample',
  'borelog.sampleCountMany': '{n} samples',
  'borelog.toggleColumns': 'Toggle columns',
  'borelog.toggleColumnsHint': 'Show or hide borelog columns',
  'borelog.columns': 'Columns',
  'borelog.columnsHidden': 'Columns ({n} hidden)',
  'borelog.hideColumn': 'Hide column',
  'borelog.trackNotPresent': 'This track is not present on this borehole',
  'borelog.cannotHideLast': 'Cannot hide: this is the last visible column',
  'borelog.missingValue': '(missing)',
  // Observation-track display labels — the DOV observation_type token stays raw
  // in the domain; only the rendered label is translated (TrackHeader + the
  // columns dropdown). Unknown tokens fall back to the raw token.
  'borelog.obs.coded_lithology': 'Coded lithology',
  'borelog.obs.geotechnical_coding': 'Geotechnical coding',
  'borelog.obs.lithological_description': 'Lithological description',
  'borelog.obs.formal_stratigraphy': 'Formal stratigraphy',
  'borelog.obs.informal_stratigraphy': 'Informal stratigraphy',
  'borelog.obs.quaternary_stratigraphy': 'Quaternary stratigraphy',
  'borelog.obs.hydrogeological_stratigraphy': 'Hydrogeological stratigraphy',
  'borelog.obs.informal_hydrogeological_stratigraphy': 'Informal hydrogeological stratigraphy',
  'borelog.followSection': 'Follow section',
  'borelog.toggleVirtueleBoring': 'Toggle DOV Virtuele Boring overlay',
  'borelog.dovPickModelHint':
    'Pick a DOV model in the dropdown or the section pane to enable this overlay',
  'borelog.hideDovOverlay': 'Hide DOV Virtuele Boring overlay',
  'borelog.showDovOverlay': 'Show DOV Virtuele Boring overlay',
  'borelog.dovOverlayModel': 'DOV overlay model for this pane',
  'borelog.overrideDovModel': 'Override which DOV model this pane shows',
  'borelog.loadingDovPredictions': 'Loading DOV predictions',
  'borelog.dovUnavailable': 'DOV layer models unavailable',
  'borelog.zoomInVertical': 'Zoom in (vertical scale)',
  'borelog.zoomOutVertical': 'Zoom out (vertical scale)',
  'borelog.resetZoom1x': 'Reset zoom to 1×',
  'borelog.noSurfaceElevation':
    'Surface elevation missing. Borelog renders without absolute level axis.',
  // DOV Virtuele Boring overlay + samples/groundwater helpers on the SVG.
  'borelog.noData': 'no data',
  'borelog.waterMarker': '▾ water at {depth} m',
  'borelog.labTestCountOne': '{n} lab test',
  'borelog.labTestCountMany': '{n} lab tests',
  'borelog.noTests': 'no tests',
  'borelog.hideColumnAria': 'Hide {title} column',
  'chart.zMissing': 'Z missing',
  // CPT chart run-summary line, legend + recharts axis / tooltip chrome.
  'chart.runSummary': '{type} · {rows} rows · {depth} m',
  'chart.preDrill': 'Pre-drill {depth} m',
  'chart.lengthAxis': 'Length (m)',
  'chart.depthAxis': 'Depth (m)',
  'chart.levelAxis': 'Level ({datum})',
  'chart.surfaceRef': '{level} m (surface)',
  'chart.tooltipDepth': 'Depth: {depth} m',
  'chart.tooltipLevelSuffix': '  |  Level: {level}',
  'chart.invertRfAxis': 'Invert Rf axis',

  // -------------------------------------------------------------------------
  // lab tests.
  // -------------------------------------------------------------------------
  'lab.sample': 'Sample',
  'lab.grainSize': 'Grain size',
  'lab.identificationTests': 'Identification tests',
  'lab.otherLabTests': 'Other lab tests',
  'lab.noTestsForSample': 'No lab tests recorded for this sample.',
  'lab.curveNotRecorded': 'Curve not recorded.',
  'lab.atterberg': 'Atterberg',
  'lab.cobbles': 'Cobbles',
  // Lab-test panel — sample header nav, grain-size chart chrome + treatments.
  'lab.unnumbered': '(unnumbered)',
  'lab.previousSample': 'Previous: {name}',
  'lab.noPreviousSample': 'No previous sample',
  'lab.nextSample': 'Next: {name}',
  'lab.noNextSample': 'No next sample',
  'lab.methodsCombined': '{n} methods combined',
  'lab.methodN': 'Method {n}',
  'lab.limeRemoved': 'lime removed',
  'lab.organicsRemoved': 'organics removed',
  'lab.pctFiner': '% finer',
  'lab.diameterAxis': 'Diameter (mm)',

  // -------------------------------------------------------------------------
  // elevation editor.
  // -------------------------------------------------------------------------
  'elevation.edit': 'Edit surface elevation',
  'elevation.set': 'Set elevation',
  'elevation.addHint': 'Add a surface elevation so this record can be correlated with others',
  'elevation.clearHint': "Clear elevation: returns the row to the 'needs Z' state",
  'elevation.verticalReference': 'Vertical reference system',
  'elevation.saveEnter': 'Save (Enter)',
  'elevation.cancelEsc': 'Cancel (Esc)',
  'elevation.saveFailed': 'Save failed',
  'elevation.sourceTitle': 'Elevation source: {source}',
  'elevation.sourceManual': 'manual',
  'elevation.clear': 'Clear',
  'elevation.enterANumber': 'Enter a number',
  'elevation.outOfRange': 'Out of range',

  // -------------------------------------------------------------------------
  // composition + formation dialogs (litho interpretation).
  // -------------------------------------------------------------------------
  'composition.topOfWhichLithoUnit': 'Top of which litho unit?',
  'composition.mainLithology': 'Main lithology',
  'composition.mainSoil': 'Main soil',
  'composition.admixtures': 'Admixtures',
  'composition.addAdmixture': 'Add admixture',
  'composition.removeAdmixture': 'Remove admixture',
  'composition.admixtureSoilCode': 'Admixture soil code',
  'composition.admixtureAmount': 'Admixture amount',
  'composition.noAdmixtures': 'No admixtures.',
  'composition.preview': 'Preview',
  'composition.save': 'Save composition',
  'composition.fixedByCorrelation': '(fixed by correlation group)',
  'composition.locally': 'locally',
  'composition.editAdmixturesTitle': 'Edit admixtures for this body',
  'composition.editSuggestionTitle': 'Edit suggestion composition',
  'composition.within': 'within:',
  'composition.parentAutoResolved':
    'The parent stratigraphic formation is resolved automatically when the contact is committed. If no stratigraphy is mapped here, the unit appears under "Unassigned".',
  'composition.unassigned': 'Unassigned',
  'composition.tabExisting': 'Existing units',
  'composition.tabNew': 'New unit',
  'composition.noUnitsInFormation':
    'No litho units in this stratigraphic formation yet. Use the "New unit" tab to create one.',
  'composition.noUnitsInModel':
    'No litho units in this model yet. Use the "New unit" tab to create the first one.',
  'composition.under': 'under {name}',
  'composition.creating': 'Creating…',
  'composition.createUnit': 'Create unit',
  'formation.topOfWhichFormation': 'Top of which formation?',
  'formation.newHere': 'New formation here',
  'formation.newHereHint': 'Create a new formation and commit this contact in one step',
  'formation.fromBoreholes': 'From boreholes',
  'formation.noneDefined': 'No formations defined yet. Create one with the button below',
  'formation.blurb': 'A formation is a substrate unit you reference in the interpretation.',
  'formation.namePlaceholder': 'e.g. Boom Klei',
  'formation.codePlaceholder': 'e.g. stratigraphic chart code',
  'formation.lensCodeHint': '(optional: sets the lens code)',
  'formation.searchFormal': 'Search formal unit (e.g. Holoceen, QH)…',
  'formation.notInModel': ' (formation not in your model).',
  // FormationDialog (create/edit) + FormationPickerDialog chrome.
  'formation.editTitle': 'Edit formation',
  'formation.newTitle': 'New formation',
  'formation.dialogBlurb':
    'A formation is a substrate unit you reference in the stratigraphic model, e.g.',
  'formation.exampleQuaternary': 'Quaternary deposits',
  'formation.colour': 'Colour',
  'formation.regionalReference': 'Regional reference',
  'formation.formalStratigraphy': 'Formal stratigraphy',
  'formation.clear': 'Clear',
  'formation.noneDefinedPickerPre':
    'No formations defined yet. Create one with the button below or use',
  'formation.noneDefinedPickerPost': 'in the Ground model pane.',

  // -------------------------------------------------------------------------
  // confirm dialogs shared across surfaces.
  // -------------------------------------------------------------------------
  'dialog.cptRefreshStored': 'Stored',
  'dialog.cptRefreshThisFile': 'This file',
  'dialog.cptRefreshReadings': 'Readings',
  'dialog.cptRefreshReplace': 'Replace data',
  'dialog.dedupeTitle': 'Remove duplicate contacts?',
  'dialog.dedupeConfirm': 'Remove duplicates',
  'dialog.dedupeNothing':
    'Nothing in the contacts loaded here looks duplicated. Running the cleanup re-checks against the saved model and removes anything it finds.',
  'dialog.dedupeRule':
    'One pick survives in each pair: a hand-placed pick is always kept over an auto-placed one, and between two of the same kind the one still linked to a borehole layer wins, then the newest.',
  // Deletion count sentence, split so the bold count and the pair clause each
  // pluralise on their own.
  'dialog.dedupeCountOne': '{n} contact',
  'dialog.dedupeCountMany': '{n} contacts',
  'dialog.dedupePairsOne':
    'will be permanently deleted, across {pairs} investigation-and-formation pair that carries more than one pick.',
  'dialog.dedupePairsMany':
    'will be permanently deleted, across {pairs} investigation-and-formation pairs that carry more than one pick.',
  'dialog.dedupeUndo':
    'This cannot be undone. Nothing puts a removed contact back. Closing the project without saving rolls the whole project back to the last save.',
  'dialog.reCorrelateTitle': 'Auto-correlate found existing edges',
  'dialog.reCorrelateRerun': 'Re-correlate: delete auto edges and rerun',
  'dialog.reCorrelateSkip': 'Skip: keep existing',
  'dialog.reCorrelateNote':
    "Manual edges (and other sections' suggestions) are preserved either way.",
  // Body sentence, split around the bold count so "{n}" can be emphasised.
  'dialog.reCorrelateBodyPreOne': 'There is already',
  'dialog.reCorrelateBodyPreMany': 'There are already',
  'dialog.reCorrelateBodyPostOne':
    'auto-correlation edge on this section. What would you like to do?',
  'dialog.reCorrelateBodyPostMany':
    'auto-correlation edges on this section. What would you like to do?',
  'dialog.snapTitle': 'Snap to stratigraphic contact?',
  'dialog.snapLithoToGeo': 'Snap litho to stratigraphic',
  'dialog.snapGeoToLitho': 'Move stratigraphic to litho',
  'dialog.snapKeepSeparate': 'Cancel: keep separate',
  'dialog.snapPickContact': 'Pick a stratigraphic contact',
  'dialog.copyCompositionTitle': 'Replace target composition?',
  'dialog.copyCompositionReplace': 'Replace',
  'dialog.copyCompositionFrom': 'From:',
  'dialog.copyCompositionTo': 'To (currently):',
  'dialog.copyCompositionBody':
    'The target layer already carries an edit. Replacing it will drop the existing composition.',
  'dialog.moveRestatedTitle': 'Move it',
  'dialog.moveRestatedUndoNote': 'One step on the undo stack. Ctrl+Z puts all of it back.',
  'dialog.crossingPickerTitle': 'Open in which cross-section?',
  'dialog.crossingPickerBlurb': 'Pick a cross-section',
  'dialog.crossingPickerOpen': 'Open section',
  // Body sentence, split around the bold count.
  'dialog.crossingPickerBodyPre': 'The offending contacts appear on',
  'dialog.crossingPickerBodyPost': 'cross-sections. Pick one to navigate to.',
  'dialog.recoveryRestore': 'Restore',
  'dialog.recoveryNotNow': 'Not now',
  'dialog.recoveryDeleteBackup': 'Delete backup',
  'dialog.recoveryUntouched': 'Your saved project is untouched.',
  // CPT refresh-on-reimport confirm dialog. Title is split around the bold
  // CPT name so the value can be emphasised while the phrase reorders in NL.
  'dialog.cptRefreshTitlePre': 'Replace',
  'dialog.cptRefreshTitlePost': '’s data with this file?',
  'dialog.cptRefreshBody':
    ' is already in this project. Importing it replaces the stored measurements. This cannot be undone, and any interpretation anchored below the new depth will need checking.',
  'dialog.cptRefreshWarningsOne': 'The new file parsed with {n} warning.',
  'dialog.cptRefreshWarningsMany': 'The new file parsed with {n} warnings.',
  // Shared picker-dialog anchor subtitle (formation + litho pickers).
  'dialog.pickerAnchorPre': 'On',
  'dialog.pickerAnchorAt': 'at depth {depth} m ({taw} m TAW)',

  // -------------------------------------------------------------------------
  // undo-stack action labels — shown in the undo toast / tooltip.
  // -------------------------------------------------------------------------
  'undo.createContact': 'Create contact',
  'undo.deleteContact': 'Delete contact',
  'undo.moveContact': 'Move contact',
  'undo.moveBoundary': 'Move boundary',
  'undo.mergeContactUp': 'Merge contact up',
  'undo.mergeContactDown': 'Merge contact down',
  'undo.createSection': 'Create cross-section',
  'undo.deleteSection': 'Delete cross-section',
  'undo.updateContacts': 'Update contacts ({n})',
  'undo.copyContacts': 'Copy contacts ({copied})',
  'undo.copyMoveContacts': 'Copy {copied} and move {moved} contacts',
  'undo.correlateContacts': 'Correlate contacts',
  'undo.uncorrelateContacts': 'Uncorrelate contacts',
  'undo.removeFromSection': 'Remove {id} from section',
  'undo.seedFromStratigraphy': 'Seed from stratigraphy (+{n} contacts)',
  // Formation CRUD.
  'undo.createFormation': 'Create formation',
  'undo.editFormation': 'Edit formation',
  'undo.recolorFormation': 'Recolor formation',
  'undo.deleteFormation': 'Delete formation',
  'undo.reorderFormations': 'Reorder formations ({n})',
  // Litho ghost (pending suggestion) gestures.
  'undo.moveLithoBoundary': 'Move litho boundary',
  'undo.editLithoComposition': 'Edit litho layer composition',
  'undo.insertLithoLayer': 'Insert litho layer',
  'undo.splitLithoLayer': 'Split litho layer',
  'undo.copyLithoContact': 'Copy litho contact',
  'undo.copyGhostContact': 'Copy litho suggestions',
  'undo.mergeLithoLayers': 'Merge litho layers',
  'undo.absorbLithoLayer': 'Absorb litho layer',
  'undo.rejectSuggestion': 'Reject suggestion',
  'undo.unrejectSuggestion': 'Restore suggestion',
  'undo.createManualGhost': 'Draw litho layer',
  'undo.acceptLithoLayer': 'Accept litho layer ({soil})',
  'undo.acceptAllLithoLayers': 'Accept all litho layers ({n})',
  'undo.acceptAllLithoLayersAcrossInvestigations': 'Accept all litho layers ({n} investigations)',
  // Committed litho + geotech packing bands.
  'undo.splitLayer': 'Split layer',
  'undo.setPackingClass': 'Set packing class',
  'undo.movePackingBoundary': 'Move packing boundary',
  'undo.splitPackingBand': 'Split packing band',
  'undo.absorbPackingLens': 'Absorb packing lens',
  'undo.mergePackingBands': 'Merge packing bands',
  'undo.disconnectPackingBands': 'Disconnect packing bands',
  // Borehole membership + elevation.
  'undo.includeBoreholeGeo': 'Include borehole in model',
  'undo.excludeBoreholeGeo': 'Exclude borehole from model',
  'undo.includeBoreholeLitho': 'Include borehole in lithological model',
  'undo.excludeBoreholeLitho': 'Exclude borehole from lithological model',
  'undo.editCptElevation': 'Edit CPT elevation',
  'undo.editBoreholeElevation': 'Edit borehole elevation',
  'undo.dovImport': 'DOV import',
  // The diverged-state safety net toast (no em-dash: sentence-final period).
  'undo.undoFailed': 'Undo failed: {action}. History cleared to keep state safe.',
  'undo.redoFailed': 'Redo failed: {action}. History cleared to keep state safe.',

  // -------------------------------------------------------------------------
  // cheatsheet (F1).
  // -------------------------------------------------------------------------
  'cheatsheet.title': 'Gestures & shortcuts',
  'cheatsheet.close': 'Close cheatsheet',
  'cheatsheet.search': 'Search gestures',
  'cheatsheet.global': 'Global',
  'cheatsheet.listsSidebar': 'Lists & sidebar',
  'cheatsheet.detailPanel': 'Detail panel (inspector)',
  'cheatsheet.map': 'Map',
  'cheatsheet.borelogCharts': 'Borehole log & charts',
  'cheatsheet.escHint':
    'Context-dependent: close dialog / panel · cancel draw, drag or marquee · peel one section interaction layer · clear selection',
  'cheatsheet.searchPlaceholder': 'Search gestures, e.g. marquee, alt, zoom',
  'cheatsheet.noMatch': 'No gesture matches “{query}”.',
} as const
