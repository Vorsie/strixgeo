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
} as const
