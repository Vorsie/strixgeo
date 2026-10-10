// Boreholes from a PDF report: triage list, the two confirmations (X/Y without
// a system, a water level without a unit) and the import.
// WIRED: BoreholePdfImportDialog, BoreholePdfTriageList, BoreholePdfQuestions
// and useBoreholePdfImport read these keys.
//
// Part of the English message catalogue — see 'locales/en/index.ts' for the
// key-naming rules and the domain-canon carve-out.

export const BOREHOLE_PDF = {
  'boreholePdf.title': 'Boreholes from a PDF report',
  'boreholePdf.pickerFilter': 'PDF reports',
  'boreholePdf.uploading': 'Uploading the report…',
  'boreholePdf.starting': 'Starting…',
  'boreholePdf.phase.classify': 'Reading pages ({done}/{total})…',
  'boreholePdf.phase.digitise': 'Reading borehole logs ({done}/{total})…',
  'boreholePdf.phase.ocr': 'Reading pages with OCR ({done}/{total})…',
  'boreholePdf.failed': 'The report could not be read: {message}',
  'boreholePdf.summary': '{n} boreholes found',
  'boreholePdf.none': 'No borehole logs found in this report.',
  'boreholePdf.ocrUnavailable':
    '{n} page(s) without a text layer not read: scanned pages need the OCR add-on.',
  'boreholePdf.pages': 'p. {pages}',
  'boreholePdf.depth': '{top} to {base} m',
  'boreholePdf.groundLevel': 'ground {z} m',
  'boreholePdf.noPosition': 'no position',
  'boreholePdf.counts': '{layers} layers, {samples} samples',
  'boreholePdf.water': 'water {depth} m below ground',
  'boreholePdf.readByOcr': 'read by OCR',
  'boreholePdf.notParsed': 'layout not known: cannot be imported',
  'boreholePdf.notImportable': 'cannot be imported: no position or ground level',
  'boreholePdf.repeatOf': 'second print of {other}: tick only one of the two',
  'boreholePdf.thumbnailAlt': 'Page {page} of the report',
  'boreholePdf.crs.question': 'X/Y printed without a coordinate system:',
  'boreholePdf.crs.this': 'This borehole is Lambert 72',
  'boreholePdf.crs.report': 'All boreholes in this report are Lambert 72',
  'boreholePdf.crs.other': 'Another system',
  'boreholePdf.crs.otherLabel': 'Coordinate system',
  'boreholePdf.water.question': 'Water level {value} printed without a unit:',
  'boreholePdf.water.confirm': 'cm below ground ({depth} m)',
  'boreholePdf.mustConfirm': '{n} ticked borehole(s) still await a confirmation.',
  'boreholePdf.repeatTicked': 'Two prints of the same borehole are ticked: untick one.',
  'boreholePdf.droppedHeading': 'Left out ({n})',
  'boreholePdf.droppedRepeat': '{name} (p. {pages}): repeat print with exactly the same data',
  'boreholePdf.selectAll': 'Select all',
  'boreholePdf.selectNone': 'Select none',
  'boreholePdf.importSelected': 'Import selection ({n})',
  'boreholePdf.importing': 'Importing…',
  'boreholePdf.refused': 'Import refused: {message}',
  'boreholePdf.toast.none': 'No boreholes imported from the report',
} as const
