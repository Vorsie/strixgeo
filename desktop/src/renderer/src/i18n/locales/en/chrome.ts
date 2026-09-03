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
  'common.none': '— none —',
  'common.unspecified': '— (unspecified)',
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
  'app.bootFailedTitle': 'Failed to start the StrixGeo API',
  'app.bootFailedBody': 'Check the developer console for the Python traceback.',
  'app.backendFailedTitle': 'StrixGeo failed to start',
  'app.backendUnreachable': 'Backend unreachable',
  // Backend refusal codes an engineer can hit in normal use (api/clients/apiCodeMessages.ts).
  'api.code.dovImportTooLarge': 'This box holds more records than one import can take. Draw a smaller box.',
  'api.code.dovImportAlreadyRunning': 'This DOV import is already running.',
  'api.code.bodyPartitionLocked': 'Another body operation is still running on this model. Try again in a moment.',
  'api.code.lockTimeout': 'The database was busy for too long. Try again in a moment.',
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
    'This project was saved by a newer version of StrixGeo (file format {version}). Update StrixGeo to open it — your data is safe.',
  'welcome.fileMoved': 'Put it back, or open it from its new location with "Open project from file".',

  // -------------------------------------------------------------------------
  // project — new-project + metadata dialogs.
  // -------------------------------------------------------------------------
  'project.new': 'New project',
  'project.name': 'Project name',
  'project.namePlaceholder': 'e.g. GEO-22/040 Bruges',
  'project.metadata': 'Project metadata',
  'project.metadataBlurb': "Edit the project's header info. Changes save to the database",
  'project.number': 'Project number',
  'project.numberPlaceholder': 'e.g. GEO-2026-042',
  'project.client': 'Client',
  'project.clientPlaceholder': 'e.g. Port of Antwerp',
  'project.site': 'Site / location label',
  'project.sitePlaceholder': 'e.g. Antwerp port — quay 7',
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
  'project.closeConfirmTitle': 'Close this project?',
  'project.closeConfirmBody':
    'The .strix file and your saved data are kept — you can reopen it any time.',
  'project.closeHint':
    'Close project — returns to the welcome screen. The .strix file and DB data are kept.',
  'project.save': 'Save project (Ctrl+S)',
  'project.unsavedHint': 'Unsaved changes — File → Save (Ctrl+S) to commit',
  'project.createdSinceSave': 'Created since last save — File → Save to commit',
  'project.discardChanges': 'Discard all changes',
  'project.discardBody':
    'Discarding cannot be undone. Cancel keeps the project open so you can save.',

  // -------------------------------------------------------------------------
  // spine + shell landmarks — the stage rail down the left edge.
  // -------------------------------------------------------------------------
  'spine.title': 'Workflow stages',
  'spine.data': 'Data',
  'spine.sections': 'Sections',
  'spine.geology': 'Geology',
  'spine.lithology': 'Litho',
  'spine.geotechnical': 'Geotech',
  'spine.parameters': 'Parameters',
  'spine.export': 'Export',
  'spine.selectionFooterAria': '{n} selected — click to clear',
  'spine.selectionFooterTitle': '{n} selected across stages — click to clear',
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
  'common.geologicalContactWordOne': 'geological contact',
  'common.geologicalContactWordMany': 'geological contacts',
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
    '— saving and every other change are unavailable, and recent actions may not have been stored. Restart the app to reconnect.',
  'app.backendRestartingBody':
    'The backend restarted and the app is reconnecting. This takes a moment — your work is safe in the database.',
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
    '— puts the unsaved work back. Nothing is saved to the file until you click Save in the app.',
  'welcome.recoveryNotNowDesc':
    '— opens the project as last saved. The backup is offered again next launch.',
  'welcome.recoveryDeleteBackupDesc':
    '— as if the session never happened: the project returns to its last save and the unsaved work is permanently discarded.',
  'welcome.recoveryLithoTriage': 'Litho suggestion triage on {count} {columnWord}',
  'welcome.recoveryMetadataEdits': 'unsaved project-metadata edits',
  'welcome.recoveryLumpingMap': 'the stratigraphy lumping map ({count} {groupingWord})',
  'welcome.recoveryUnsavedMarker': 'the unsaved-changes marker',

  // -------------------------------------------------------------------------
  // project — new-project blurb, metadata + close copy, discard/revert toasts.
  // NOTE (owner reconcile): namePlaceholderExample ("Brugge") differs from the
  // catalogue namePlaceholder ("Bruges"); metadataBlurbFull, closeConfirmBody-
  // Detailed and closeHintGmproj carry the component's stale ".gmproj" wording
  // (the catalogue's project.metadataBlurb / .closeConfirmBody / .closeHint use
  // ".strix").
  // -------------------------------------------------------------------------
  'project.newBlurb':
    "Name it now; richer details (client, site, tags, default CRSes…) can be added from the project's metadata editor when that lands.",
  'project.createEllipsis': 'Create…',
  'project.namePlaceholderExample': 'e.g. GEO-22/040 Brugge',
  'project.metadataBlurbFull':
    "Edit the project's header info. Changes save to the database and the .gmproj file in one go.",
  'project.removeTag': 'Remove {tag}',
  'project.closeConfirmBodyDetailed':
    "will close and you'll be returned to the welcome screen. The .gmproj file and your saved data are kept — you can reopen from the Recent list.",
  'project.closeHintGmproj':
    'Close project — returns to the welcome screen. The .gmproj file and DB data are kept.',
  'project.editMetadataHint': 'Click to edit project metadata',
  'project.editMetadataHintWithPath': '{path} — click to edit project metadata',
  'project.revertNotLatest':
    'Could not revert: this file is not the project’s latest save. The backup was kept.',
  'project.revertFailed': 'Could not revert the project to its last save — the backup was kept.',
  'project.fileNotFoundToast':
    "Couldn't find the project file at {path}. Did you move or rename it?",
  'project.discardLossInterpretation':
    'Correlations, boundary moves, accepted suggestions and deletions made this session, in any stage — these are not counted here.',
  'project.discardLossMetadata': 'Unsaved edits in the project metadata editor.',
  'project.discardLeadSaved':
    'Discard reverts the whole project — in the database, across every stage — to its last saved state.',
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
    '{n} more {actionWord} — the toolbar is narrower than the full verb row',
  'shell.collapseInspector': 'Collapse inspector',
  'shell.expandInspector': 'Expand inspector',
  'shell.clickForOptionsTitle': '{label} — click for options',
  'shell.optionsAria': '{label} options',
  'shell.themeSystem': 'System theme',
  'shell.themeLight': 'Light theme',
  'shell.themeDark': 'Dark theme',
  'shell.themeToggleTitle': '{current} (click for {next})',
} as const
