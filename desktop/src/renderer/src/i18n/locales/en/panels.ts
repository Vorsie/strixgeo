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
  'borelog.cannotHideLast': 'Cannot hide — this is the last visible column',
  'borelog.missingValue': '— missing —',
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
  'borelog.zoomInVertical': 'Zoom in (vertical scale)',
  'borelog.zoomOutVertical': 'Zoom out (vertical scale)',
  'borelog.resetZoom1x': 'Reset zoom to 1×',
  'borelog.noSurfaceElevation':
    'Surface elevation missing — borelog renders without absolute level axis.',
  'chart.zMissing': 'Z missing',

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

  // -------------------------------------------------------------------------
  // elevation editor.
  // -------------------------------------------------------------------------
  'elevation.edit': 'Edit surface elevation',
  'elevation.set': 'Set elevation',
  'elevation.addHint': 'Add a surface elevation so this record can be correlated with others',
  'elevation.clearHint': "Clear elevation — returns the row to the 'needs Z' state",
  'elevation.verticalReference': 'Vertical reference system',
  'elevation.saveEnter': 'Save (Enter)',
  'elevation.cancelEsc': 'Cancel (Esc)',
  'elevation.saveFailed': 'Save failed',

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
  'formation.topOfWhichFormation': 'Top of which formation?',
  'formation.newHere': 'New formation here',
  'formation.newHereHint': 'Create a new formation and commit this contact in one step',
  'formation.fromBoreholes': 'From boreholes',
  'formation.noneDefined': 'No formations defined yet — create one with the button below',
  'formation.blurb': 'A formation is a substrate unit you reference in the interpretation.',
  'formation.namePlaceholder': 'e.g. Boom Klei',
  'formation.codePlaceholder': 'e.g. stratigraphic chart code',
  'formation.lensCodeHint': '(optional — sets the lens code)',
  'formation.searchFormal': 'Search formal unit (e.g. Holoceen, QH)…',
  'formation.notInModel': ' — formation not in your model.',

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
    'This cannot be undone — nothing puts a removed contact back. Closing the project without saving rolls the whole project back to the last save.',
  'dialog.reCorrelateTitle': 'Auto-correlate found existing edges',
  'dialog.reCorrelateRerun': 'Re-correlate — delete auto edges and rerun',
  'dialog.reCorrelateSkip': 'Skip — keep existing',
  'dialog.reCorrelateNote':
    "Manual edges — and other sections' suggestions — are preserved either way.",
  // Body sentence, split around the bold count so "{n}" can be emphasised.
  'dialog.reCorrelateBodyPreOne': 'There is already',
  'dialog.reCorrelateBodyPreMany': 'There are already',
  'dialog.reCorrelateBodyPostOne':
    'auto-correlation edge on this section. What would you like to do?',
  'dialog.reCorrelateBodyPostMany':
    'auto-correlation edges on this section. What would you like to do?',
  'dialog.snapTitle': 'Snap to geological contact?',
  'dialog.snapLithoToGeo': 'Snap litho to geological',
  'dialog.snapGeoToLitho': 'Move geological to litho',
  'dialog.snapKeepSeparate': 'Cancel — keep separate',
  'dialog.snapPickContact': 'Pick a geological contact',
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
} as const
