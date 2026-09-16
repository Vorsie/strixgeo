// Launch-prototype chrome — onboarding (#93), licensing/activation (#3) and the
// updater notification (#6). See docs/design/onboarding-activation-updater-proto.md.
//
// Part of the English message catalogue — see 'locales/en/index.ts' for the
// key-naming rules. Product + tier names (StrixGeo, Solo, Pro, Studio) and the
// demo licence keys are NOT translated: they are product identifiers, rendered
// as raw tokens, never routed through a second vocabulary.

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
  // licensing — activation screen (#3). Tier names stay raw tokens.
  // -------------------------------------------------------------------------
  'licensing.title': 'Licence & activation',
  'licensing.statusHeading': 'Status',
  'licensing.deviceHeading': 'This device',
  'licensing.tierLabel': 'Tier',
  'licensing.expiresLabel': 'Renews / ends',
  'licensing.stateUnactivated': 'Not activated',
  'licensing.stateTrial': 'Trial',
  'licensing.stateActive': 'Active',
  'licensing.stateGrace': 'Offline grace',
  'licensing.stateExpired': 'Expired',
  'licensing.stateClockRollback': 'Clock problem',
  'licensing.stateDeviceMismatch': 'Wrong device',
  'licensing.daysRemaining': '{days} day(s) remaining',
  'licensing.graceRemaining': '{days} day(s) of offline grace left',
  'licensing.enterKey': 'Enter a licence key',
  'licensing.activate': 'Activate',
  'licensing.startTrial': 'Start free trial',
  'licensing.deactivate': 'Deactivate / transfer this device',
  'licensing.deactivateHint': 'Frees this seat so you can activate on another machine.',
  // Confirmation dialog for the irreversible deactivate / transfer (docs/ux.md).
  'licensing.deactivateConfirmTitle': 'Deactivate this device?',
  'licensing.deactivateConfirmBody':
    'This frees the seat so you can activate on another machine. The app returns to the activation screen.',
  'licensing.deactivateConfirmAction': 'Deactivate',
  'licensing.demoKeysHint': 'Prototype demo keys: STRIX-SOLO-DEMO, STRIX-PRO-DEMO, STRIX-STUDIO-DEMO.',
  'licensing.previewHeading': 'Preview a state (prototype only)',
  'licensing.errorUnknownKey': 'That licence key was not recognised.',
  'licensing.errorDeviceLimit':
    'This key is already active on another device. Deactivate it there, or transfer the seat.',
  'licensing.errorAlreadyTrialled': 'This device has already used its free trial.',
  'licensing.errorUnreachable': 'Could not reach the activation server.',
  'licensing.toastActivated': 'Licence activated.',
  'licensing.toastTrialStarted': 'Free trial started.',
  'licensing.toastDeactivated': 'This device was deactivated.',
  // Build facts (finding f): the beta expiry stamp + git SHA, shown next to the
  // licence expiry so a tester can verify which build they hold. Date is
  // formatted by the caller ("1 November 2026").
  'licensing.buildHeading': 'This build',
  'licensing.betaBuild': 'Beta build {sha}, expires {date}',
  'licensing.buildUnstamped': 'Development build (no expiry stamp)',

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
  'updater.downloadedBody': 'Version {version} will be applied when you restart.',
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
