// Shell chrome — shared verbs, boot + backend states, the project launcher,
// project metadata, and the workflow-stage rail.
//
// Part of the English message catalogue — see 'locales/en/index.ts' for the
// key-naming rules and the domain-canon carve-out.

export const CHROME = {
  // -------------------------------------------------------------------------
  // common — verbs and nouns shared by every surface. Translate once here;
  // a surface only gets its own key when its wording must differ.
  // -------------------------------------------------------------------------
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.delete': 'Delete',
  // The action button on an IRREVERSIBLE database-delete confirm. Distinct from
  // the reversible project-local hide (``common.remove``) — in NL both would
  // otherwise read "Verwijderen" once the hide verb was renamed (owner
  // 2026-09-03), collapsing the reversible/irreversible distinction docs/ux.md
  // requires. English already distinguishes Remove vs Delete; the emphatic form
  // keeps the confirm unambiguous in both locales.
  'common.deletePermanently': 'Delete permanently',
  'common.remove': 'Remove',
  'common.open': 'Open',
  'common.apply': 'Apply',
  'common.confirm': 'Confirm',
  'common.dismiss': 'Dismiss',
  'common.undo': 'Undo',
  'common.reset': 'Reset',
  'common.retry': 'Retry',
  'common.rename': 'Rename',
  'common.edit': 'Edit',
  'common.create': 'Create',
  'common.import': 'Import',
  'common.export': 'Export',
  'common.loading': 'Loading…',
  'common.name': 'Name',
  'common.depth': 'Depth',
  'common.elevation': 'Elevation',
  'common.optional': '(optional)',
  'common.none': '(none)',
  'common.unspecified': '(unspecified)',
  'common.zoomIn': 'Zoom in',
  'common.zoomOut': 'Zoom out',
  'common.resetZoom': 'Reset zoom',
  'common.resetView': 'Reset view',
  'common.thisCannotBeUndone': 'This cannot be undone.',

  // -------------------------------------------------------------------------
  // app — window chrome, boot states, backend health.
  // -------------------------------------------------------------------------
  'app.name': 'StrixGeo',
  'app.starting': 'Starting StrixGeo API…',
  'app.startingLong': 'Starting StrixGeo is taking longer than usual. It is still preparing its data service…',
  'app.bootFailedTitle': 'Failed to start the StrixGeo API',
  'app.bootFailedBody': 'Help → Save logs for support… saves a diagnostic bundle for support.',
  'app.backendFailedTitle': 'StrixGeo failed to start',
  'app.backendUnreachable': 'Backend unreachable',
  // Backend refusal codes an engineer can hit in normal use (api/clients/apiCodeMessages.ts).
  'api.code.dovImportTooLarge': 'This box holds more records than one import can take. Draw a smaller box.',
  'api.code.dovImportAlreadyRunning': 'This DOV import is already running.',
  'api.code.bodyPartitionLocked': 'Another body operation is still running on this model. Try again in a moment.',
  'api.code.lockTimeout': 'The database was busy for too long. Try again in a moment.',
  'api.code.dovUnreachable': 'DOV is not reachable right now; the predictions will load when it is.',
  'api.code.labBoreholeConflict': 'Borehole {name} was added to this project by another lab preview while this one ran. Open the preview again to use it.',
  'api.code.labBoreholeConflictUnnamed': 'A borehole for this file was added to this project by another lab preview while this one ran. Open the preview again to use it.',
  'app.backendRestarting': 'Reconnecting to the backend…',
  'app.quit': 'Quit StrixGeo',
  'app.reload': 'Reload StrixGeo',
  'app.crashTitle': 'StrixGeo encountered an unexpected error',
  'app.dismissNotification': 'Dismiss notification',

  // -------------------------------------------------------------------------
  // welcome — the project launcher shown before a project is open.
  // -------------------------------------------------------------------------
  'welcome.tagline': 'Open an existing project file or create a new one to start importing',
  'welcome.createProject': 'Create project…',
  'welcome.openProject': 'Open project from file…',
  'welcome.recentProjects': 'Recent projects',
  'welcome.recoveredWork': 'Recovered work',
  'welcome.recoveredWorkBody': 'These projects closed with unsaved work. Open one to restore it.',
  'welcome.recoveryDeclined': 'You chose not to restore this earlier',
  'welcome.openFailed':
    "Couldn't open the selected project file. The file may be corrupt, or the API isn't reachable.",
  'welcome.openNewerBuild':
    'This project was saved by a newer version of StrixGeo (file format {version}). Update StrixGeo to open it. Your data is safe.',
  'welcome.fileMoved': 'Put it back, or open it from its new location with "Open project from file".',

  // -------------------------------------------------------------------------
  // project — new-project + metadata dialogs.
  // -------------------------------------------------------------------------
  'project.new': 'New project',
  'project.name': 'Project name',
  'project.namePlaceholder': 'e.g. Project 2026-001, Site',
  'project.metadata': 'Project metadata',
  'project.metadataBlurb': "Edit the project's header info. Changes save to the database",
  'project.number': 'Project number',
  'project.numberPlaceholder': 'e.g. GEO-2026-042',
  'project.client': 'Client',
  'project.clientPlaceholder': 'e.g. Port of Antwerp',
  'project.site': 'Site / location label',
  'project.sitePlaceholder': 'e.g. Antwerp port, quay 7',
  'project.description': 'Description',
  'project.descriptionHint': 'Free-text scope notes',
  'project.tags': 'Tags',
  'project.tagsPlaceholder': 'Type a tag and press Enter or comma',
  'project.status': 'Status',
  'project.statusActive': 'Active',
  'project.statusOnHold': 'On hold',
  'project.statusCompleted': 'Completed',
  'project.phase': 'Phase',
  'project.phaseFeasibility': 'Feasibility',
  'project.phaseDesign': 'Design',
  'project.phaseConstruction': 'Construction',
  'project.phaseMonitoring': 'Monitoring',
  'project.defaultHorizontalCrs': 'Default horizontal CRS',
  'project.defaultVerticalCrs': 'Default vertical CRS',
  'project.close': 'Close project',
  // Empty-bundle overwrite question (debt #225). A save re-read the project
  // twice and an item the last save held still came back empty. Ask before
  // replacing the file: the engineer clears a model on purpose often enough
  // that a refusal would be wrong, but a silent overwrite would lose work.
  'project.saveEmptyBundleAskTitle': 'Some data came back empty',
  'project.saveEmptyBundleAskBody':
    'The project was read twice and the items below came back empty, although your last save held them. Saving now replaces that file. Your work is still open in the app, so you can cancel and try again.',
  'project.saveEmptyBundleAskConfirm': 'Save anyway',
  'project.saveEmptyBundleRow': '{label}: last save {expected}, now {now}',
  'project.emptyBundleCollection.correlations': 'Correlations',
  'project.emptyBundleCollection.lithoLayers': 'Lithological layers',
  'project.emptyBundleCollection.formationContacts': 'Formation contacts',
  'project.emptyBundleCollection.bodies': 'Bodies',
  'project.emptyBundleCollection.cpts': 'CPTs',
  'project.emptyBundleCollection.boreholes': 'Boreholes',
  'project.emptyBundleCollection.formations': 'Formations',
  'project.emptyBundleCollection.crossSections': 'Cross-sections',
  'project.closeConfirmTitle': 'Close this project?',
  'project.closeConfirmBody':
    'The .strix file and your saved data are kept. You can reopen it any time.',
  'project.closeHint':
    'Close project: returns to the welcome screen. The .strix file and DB data are kept.',
  'project.save': 'Save project (Ctrl+S)',
  'project.unsavedHint': 'Unsaved changes. File → Save (Ctrl+S) to commit',
  'project.createdSinceSave': 'Created since last save. File → Save to commit',
  'project.discardChanges': 'Discard all changes',
  'project.discardBody':
    'Discarding cannot be undone. Cancel keeps the project open so you can save.',
  // Force-revert confirmation (owner ruling, installer #26 2026-09-08). Shown
  // when a Discard is refused because the .strix on disk is not this project's
  // latest save — the user can still throw his session away, but the loss is
  // named first so the consent is real (docs/ux.md destructive-action rule).
  'project.closeForceRevertTitle': 'Revert to file and lose changes?',
  'project.closeForceRevertBody':
    "{file} is not this project's latest save. Reverting to it will permanently " +
    "delete this session's work and everything saved to the project since that " +
    'file was written.',
  'project.closeForceRevertConfirm': 'Revert to file and close',
  // The same question on "Delete backup" in the crash-recovery prompt (owner
  // 2026-09-10: the refusal toast was a dead end "users gaan hierop vloeken").
  'project.discardBackupForceRevertTitle': 'Revert to file and delete the backup?',
  'project.discardBackupForceRevertBody':
    "{file} is not this project's latest save. Reverting to it anyway permanently " +
    'deletes the crashed session and everything saved to the project since that ' +
    'file was written; Cancel keeps the backup.',
  'project.discardBackupForceRevertConfirm': 'Revert to file and delete backup',

  // -------------------------------------------------------------------------
  // spine + shell landmarks — the stage rail down the left edge.
  // -------------------------------------------------------------------------
  'spine.title': 'Workflow stages',
  'spine.data': 'Data',
  'spine.sections': 'Sections',
  'spine.geology': 'Stratigraphy',
  'spine.lithology': 'Litho',
  'spine.geotechnical': 'Geotech',
  'spine.parameters': 'Parameters',
  'spine.export': 'Export',
  'spine.selectionFooterAria': '{n} selected. Click to clear',
  'spine.selectionFooterTitle': '{n} selected across stages. Click to clear',
  'spine.selectionFooterLabel': '{n} selected',
  'spine.selectionFooterAbbr': 'sel.',
  'shell.toolbar': 'Stage toolbar',
  'shell.inspector': 'Stage inspector',
  // Per-stage crash card (audit M5) — a render error in one stage is contained
  // to that stage's slot; the rest of the workspace keeps working.
  'shell.stageError.title': 'This stage stopped working',
  'shell.stageError.body':
    'The other stages and your data are unaffected. Reset this stage to try again.',
  'shell.stageError.reset': 'Reset stage',

  // -------------------------------------------------------------------------
  // common — count words + list joiners (one/many selected by the caller).
  // Used by the recovery + unsaved-changes dialogs to build "3 CPTs, 1
  // borehole and 2 sections imported this session." The geology/litho modules
  // carry their own parallel word pairs; these live here so the chrome dialogs
  // stay self-contained.
  // -------------------------------------------------------------------------
  'common.cptWordOne': 'CPT',
  'common.cptWordMany': 'CPTs',
  'common.boreholeWordOne': 'borehole',
  'common.boreholeWordMany': 'boreholes',
  'common.formationWordOne': 'formation',
  'common.formationWordMany': 'formations',
  'common.sectionWordOne': 'section',
  'common.sectionWordMany': 'sections',
  'common.geologicalContactWordOne': 'stratigraphic contact',
  'common.geologicalContactWordMany': 'stratigraphic contacts',
  'common.columnWordOne': 'column',
  'common.columnWordMany': 'columns',
  'common.groupingWordOne': 'grouping',
  'common.groupingWordMany': 'groupings',
  'common.listAnd': 'and',
  'common.importedThisSession': '{list} imported this session.',

  // -------------------------------------------------------------------------
  // app — backend-body copy, log-file label, export-result toasts.
  // -------------------------------------------------------------------------
  'app.backendFailedBody':
    'The StrixGeo backend process exited before it was ready. This usually means a database connection problem or a startup crash.',
  'app.backendUnreachableBody':
    'Saving and every other change are unavailable, and recent actions may not have been stored. Restart the app to reconnect.',
  'app.backendRestartingBody':
    'The backend restarted and the app is reconnecting. This takes a moment. Your work is safe in the database.',
  'app.logFile': 'Log file:',
  'app.dxfExported': 'DXF exported.',
  'app.dxfExportFailed': 'Could not export the DXF.',
  'app.pdfExported': 'PDF exported.',
  'app.pdfExportFailed': 'Could not export the PDF.',
  'app.plaxis2dExported': 'Plaxis 2D script exported.',
  'app.plaxis2dExportFailed': 'Could not export the Plaxis 2D script.',

  // -------------------------------------------------------------------------
  // welcome — start-screen extras + the recovery-prompt dialog copy.
  // NOTE (owner reconcile): welcome.heading is the component's stale product
  // name "Ground Model"; the catalogue app.name is "StrixGeo".
  // welcome.taglineFull is the component's full tagline (welcome.tagline is a
  // truncated variant).
  // -------------------------------------------------------------------------
  'welcome.heading': 'Ground Model',
  'welcome.taglineFull':
    'Open an existing project file or create a new one to start importing and analysing data.',
  'welcome.orDivider': 'or',
  'welcome.untitledProject': 'Untitled project',
  'welcome.openToRestore': 'Open the project file to restore',
  'welcome.fromAge': 'from {age}',
  'welcome.theProject': 'the project',
  'welcome.fileNotFoundFor':
    "Couldn't find the file for {name} at {path}. Did you move or rename it?",
  'welcome.openFailedNamed':
    "Couldn't open {name}. The file may be corrupt, or the API isn't reachable.",
  'welcome.recoveryTitle': 'Restore unsaved work in {name}?',
  'welcome.recoveryIntro':
    'StrixGeo closed unexpectedly{age}. A backup of your unsaved work was kept',
  'welcome.recoverySavedUntouched': 'Your saved project is untouched.',
  'welcome.recoveryRestore': 'Restore',
  'welcome.recoveryNotNow': 'Not now',
  'welcome.recoveryDeleteBackup': 'Delete backup',
  'welcome.recoveryRestoreDesc':
    'puts the unsaved work back. Nothing is saved to the file until you click Save in the app.',
  'welcome.recoveryNotNowDesc':
    'opens the project as last saved. The backup is offered again next launch.',
  'welcome.recoveryDeleteBackupDesc':
    'discards the unsaved work for good: the project returns to its last save, as if the session never happened.',
  'welcome.recoveryLithoTriage': 'Litho suggestion triage on {count} {columnWord}',
  'welcome.recoveryMetadataEdits': 'unsaved project-metadata edits',
  'welcome.recoveryLumpingMap': 'the stratigraphy lumping map ({count} {groupingWord})',
  'welcome.recoveryUnsavedMarker': 'the unsaved-changes marker',

  // -------------------------------------------------------------------------
  // project — new-project blurb, metadata + close copy, discard/revert toasts.
  // NOTE (owner reconcile): metadataBlurbFull, closeConfirmBody-Detailed and
  // closeHintGmproj carry the component's stale ".gmproj" wording
  // (the catalogue's project.metadataBlurb / .closeConfirmBody / .closeHint use
  // ".strix").
  // -------------------------------------------------------------------------
  'project.newBlurb':
    "Name it now; richer details (client, site, tags, default CRSes…) can be added from the project's metadata editor when that lands.",
  'project.createEllipsis': 'Create…',
  'project.namePlaceholderExample': 'e.g. Project 2026-001, Site',
  'project.metadataBlurbFull':
    "Edit the project's header info. Changes save to the database and the .gmproj file in one go.",
  'project.removeTag': 'Remove {tag}',
  'project.closeConfirmBodyDetailed':
    "will close and you'll be returned to the welcome screen. The .gmproj file and your saved data are kept. You can reopen from the Recent list.",
  'project.closeHintGmproj':
    'Close project: returns to the welcome screen. The .gmproj file and DB data are kept.',
  'project.editMetadataHint': 'Click to edit project metadata',
  'project.editMetadataHintWithPath': '{path}: click to edit project metadata',
  'project.revertNotLatest':
    'Could not revert: this file is not the project’s latest save. The backup was kept.',
  'project.revertFailed': 'Could not revert the project to its last save. The backup was kept.',
  'project.fileNotFoundToast':
    "Couldn't find the project file at {path}. Did you move or rename it?",
  // Shown once when opening a .strix after a DB wipe rebuilds the project from
  // the file and the restore had to cap oversized depth-series / borehole child
  // arrays. Names both counts so the engineer knows how much, and of what, was
  // trimmed; a restore that dropped nothing stays silent.
  'project.restoreWaitingToast':
    'Still restoring… a running body recompute may be holding the project lock (up to 30 s).',
  'project.restoreDroppedToast':
    'Restore skipped oversized data: {series} depth series and {rows} child data rows. See the log.',
  'project.discardLossInterpretation':
    'These are not counted here: correlations, boundary moves, accepted suggestions and deletions made this session, in any stage.',
  'project.discardLossMetadata': 'Unsaved edits in the project metadata editor.',
  'project.discardLeadSaved':
    'Discard reverts the whole project (in the database, across every stage) to its last saved state.',
  'project.discardLeadUnsaved':
    'This project has never been saved to a file, so Discard has no saved state to go back to.',
  'project.discardFollowSaved': 'Everything done since the last File → Save is lost',
  'project.discardFollowUnsaved': 'It removes everything this session added to the project',
  'project.unsavedTitle': 'Save changes to {name}?',

  // -------------------------------------------------------------------------
  // shell — toolbar overflow, inspector toggle, split-button menus, theme.
  // -------------------------------------------------------------------------
  'shell.moreToolbarActions': 'More toolbar actions',
  'shell.more': 'More',
  'shell.actionWordOne': 'action',
  'shell.actionWordMany': 'actions',
  'shell.moreActionsTitle':
    '{n} more {actionWord}. The toolbar is narrower than the full verb row',
  'shell.collapseInspector': 'Collapse inspector',
  'shell.expandInspector': 'Expand inspector',
  'shell.clickForOptionsTitle': '{label}: click for options',
  'shell.optionsAria': '{label} options',
  'shell.themeSystem': 'System theme',
  'shell.themeLight': 'Light theme',
  'shell.themeDark': 'Dark theme',
  'shell.themeToggleTitle': '{current} (click for {next})',
} as const
