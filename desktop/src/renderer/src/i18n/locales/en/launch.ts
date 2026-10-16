// Launch chrome: onboarding (#93) and the updater notification (#6).
//
// Part of the English message catalogue; see 'locales/en/index.ts' for the
// key-naming rules. The product name (StrixGeo) is NOT translated: it is a
// product identifier, rendered as a raw token, never routed through a second
// vocabulary.

export const LAUNCH = {
  // -------------------------------------------------------------------------
  // onboarding — first-launch overlay: welcome → choose → skippable tour.
  // -------------------------------------------------------------------------
  'onboarding.welcomeTitle': 'Welcome to StrixGeo',
  'onboarding.welcomeBody':
    'StrixGeo turns CPT and borehole data into a validated ground model you can export straight to your design tools.',
  'onboarding.chooseTitle': 'How would you like to start?',
  'onboarding.sampleTitle': 'Load the sample project',
  'onboarding.sampleBody': 'Open a finished ground model and explore the whole workflow.',
  'onboarding.scratchTitle': 'Start from scratch',
  'onboarding.scratchBody': 'Create an empty project and import your own data.',
  'onboarding.tourTitle': 'A quick tour',
  'onboarding.tourIntro': 'Six stages carry raw data to a deliverable. Here is what each one does.',
  'onboarding.stepCount': 'Step {current} of {total}',
  'onboarding.skip': 'Skip',
  'onboarding.back': 'Back',
  'onboarding.next': 'Next',
  'onboarding.done': 'Get started',
  // Start-the-tutorial screen (replaces the old stage slideshow).
  'onboarding.startTitle': 'Ready to build?',
  'onboarding.startBody':
    'A short, hands-on tutorial walks you through the whole workflow on your own project, one control at a time. Skip it any time and reopen it from Help.',
  'onboarding.startTutorial': 'Start the tutorial',
  'onboarding.startLater': 'Maybe later',
  'onboarding.sampleUnavailable':
    'The sample project is not bundled in this prototype yet. Starting an empty project instead.',
  'onboarding.sampleLoaded': 'Worked example opened. Saved to {path}',
  // The six spine stages, one sentence each.
  'onboarding.stageImport': 'Import',
  'onboarding.stageImportBody': 'Bring in CPTs and boreholes from files or straight from DOV.',
  'onboarding.stageGeology': 'Stratigraphy',
  'onboarding.stageGeologyBody': 'Lay down the stratigraphic backbone: formations and their surfaces.',
  'onboarding.stageLitho': 'Lithology',
  'onboarding.stageLithoBody': 'Refine the backbone into lithological units along your sections.',
  'onboarding.stageGeotech': 'Geotechnics',
  'onboarding.stageGeotechBody': 'Subdivide units into NAD packing classes from CPT-derived indicators.',
  'onboarding.stageSections': 'Sections',
  'onboarding.stageSectionsBody': 'Draw and edit cross-sections: the surface where all three model levels are built.',
  'onboarding.stageExport': 'Export',
  'onboarding.stageExportBody': 'Send the model to Plaxis, D-Stability, DXF and PDF report slices.',

  // -------------------------------------------------------------------------
  // updater — the update-available notification (#6).
  // -------------------------------------------------------------------------
  'updater.checking': 'Checking for updates…',
  'updater.availableTitle': 'A new version is available',
  'updater.availableBody': 'Version {version} is ready to download.',
  'updater.download': 'Download',
  'updater.later': 'Later',
  'updater.downloading': 'Downloading update… {percent}%',
  'updater.downloadedTitle': 'Update ready to install',
  'updater.downloadedBody': 'Version {version} is ready. Install it now with the button, or at the next start.',
  'updater.restart': 'Restart & install',
  'updater.upToDate': 'You are on the latest version.',
  // No release published yet (finding g): calm, not a failure.
  'updater.noReleaseYet': 'No update available yet.',
  'updater.disabled': 'Updates are disabled in development.',
  'updater.error': 'Update check failed.',
  // A real failure names its cause (finding g).
  'updater.errorOffline': 'Update check failed: you appear to be offline.',
  'updater.errorBlocked': 'Update check failed: the connection was blocked (proxy or firewall).',
  'updater.errorUnexpected': 'Update check failed unexpectedly.',
  'updater.dismiss': 'Dismiss',
} as const
