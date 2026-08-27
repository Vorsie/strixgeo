// Data-stap — de importwerkwoorden en het kaart-/grafiekcanvas.
// WIRED: DataToolbar leest deze sleutels vandaag al.
//
// Part of the Dutch (BE) message catalogue — see 'locales/nl/index.ts'.

export const DATA_NL = {
  'data.toolbar.import': 'Importeren',
  // FLAG alt: Kader tekenen… | Zone tekenen… — "bbox" is the app's own word for
  // the rectangle you drag on the map. A Flemish engineer reads "kader" or
  // "zone" faster, but "bbox" matches the DOV/GIS vocabulary they already use.
  'data.toolbar.drawingBbox': 'Bbox tekenen…',
  'data.toolbar.menuLabel': 'Acties voor {label}',
  // FLAG alt: CPT importeren (.gef) — THE call of this whole review. The owner
  // writes "sonderingen"; BE practice says sondering, the file format and the
  // international literature say CPT. Ruling here propagates to ~30 strings.
  'data.toolbar.importCptGef': 'Sondering importeren (.gef)',
  'data.toolbar.importCptDov': 'Sondering importeren uit DOV (bbox tekenen)',
  'data.toolbar.importBoreholeDov': 'Boring importeren uit DOV (bbox tekenen)',
  'data.toolbar.importDmt': 'DMT importeren',
  'data.toolbar.importLabTest': 'Labproef importeren',
  'data.toolbar.importMonitoring': 'Monitoring importeren',
  'data.toolbar.phaseTag': 'Fase 4',
  'data.canvas.map': 'Kaart',
  'data.canvas.chart': 'Grafiek',
  'data.canvas.loadingChart': 'Grafiek laden…',
  'data.canvas.loadingBorehole': 'Boring laden…',
  'data.import.status': 'Status DOV-import',
  'data.import.imported': 'Geïmporteerd',
  'data.import.alreadyExisted': 'Bestond al',
  'data.import.failed': 'Mislukt',
  'data.import.samplesAttached': 'Monsters gekoppeld',
  'data.import.observationsAttached': 'Waarnemingen gekoppeld',
  'data.import.streamClosed': 'De importstroom is onverwacht afgebroken',
} as const
