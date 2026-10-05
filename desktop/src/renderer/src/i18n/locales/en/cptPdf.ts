// PDF CPT import dialog — triage list, calibration overlay, import report.
// WIRED: CptPdfImportDialog, CptPdfTriageList, CptPdfCalibrationOverlay and
// CptPdfImportReport read these keys.
//
// Part of the English message catalogue — see 'locales/en/index.ts' for the
// key-naming rules and the domain-canon carve-out.

export const CPT_PDF = {
  'cptPdf.title': 'Import CPTs from a PDF report',
  'cptPdf.pickerFilter': 'PDF reports',
  'cptPdf.uploading': 'Uploading the report…',
  'cptPdf.starting': 'Starting…',
  'cptPdf.phase.classify': 'Reading pages ({done}/{total})…',
  'cptPdf.phase.digitise': 'Digitising sheets ({done}/{total})…',
  'cptPdf.phase.ocr': 'Reading titles with OCR ({done}/{total})…',
  'cptPdf.failed': 'The report could not be read: {message}',
  'cptPdf.summary': '{n} campaign soundings in {report}',
  'cptPdf.summaryNoCode': '{n} campaign soundings',
  'cptPdf.projectNumber': 'Project number',
  'cptPdf.projectNumberHint': 'For rows that print no project number',
  'cptPdf.ocrUnavailable':
    'Tick reading unavailable: type the axis values for sheets whose labels are not text.',
  'cptPdf.rasterUnread': '{n} image page(s) not read: scanned pages need the OCR add-on.',
  'cptPdf.campaignHeading': 'Campaign soundings',
  'cptPdf.unknownHeading': 'Origin unknown (tick to import)',
  'cptPdf.notImported': 'Not imported ({n})',
  'cptPdf.lookUpYourself': 'Not imported, look these up yourself: {ids}',
  'cptPdf.pages': 'p. {pages}',
  'cptPdf.groundLevel': 'Z {z} m',
  'cptPdf.noPosition': 'no position',
  'cptPdf.calibrate': 'Check axes…',
  'cptPdf.calibrateHint':
    'Show the axes the digitiser read on the page and move them if the orange curve does not sit on the printed one',
  'cptPdf.explainer':
    'Every row was read automatically. Open Check axes to compare the read curve with the sheet, or when a row asks you to type axis values.',
  'cptPdf.edited': 'edited',
  'cptPdf.thumbnailAlt': 'Page {page} of the report',
  // Per-row notes, one key per backend ``ReportSoundingNote`` code. The EN
  // wording is the backend's own English sentence, so EN reads as before.
  'cptPdf.note.TICKS_UNAVAILABLE_NO_OCR': 'tick reading unavailable: type the axis values',
  'cptPdf.note.TICKS_NOT_READ': 'axis values not read: type two tick values per axis',
  'cptPdf.note.NO_POSITION_PRINTED': 'no position printed: type X and Y before importing',
  'cptPdf.note.ELEVATION_AXIS': 'elevation axis: depth = printed ground level - plotted elevation',
  'cptPdf.note.ELEVATION_AXIS_NO_GROUND_LEVEL':
    'elevation axis without a printed ground level: type the ground level',
  'cptPdf.note.CLIPPED_POINTS': '{count} point(s) on an axis maximum: the true value is higher',
  'cptPdf.note.READ_FROM_IMAGE': 'read from an image: check the orange curve against the sheet',
  // A drilled stretch without measurement (owner ruling "a", 2026-10-04);
  // {list} is the stretches, each written with ``cptPdf.drilledInterval``.
  'cptPdf.note.DRILLED_INTERVALS': 'Drilled: {list}',
  'cptPdf.drilledInterval': '{top} to {base} m',
  'cptPdf.selectAll': 'Select all',
  'cptPdf.selectNone': 'Select none',
  'cptPdf.importSelected': 'Import selected ({n})',
  'cptPdf.importing': 'Importing…',
  'cptPdf.overlay.title': 'Check the axes of sounding {id}',
  'cptPdf.overlay.intro':
    'Drag the frame corners onto the printed axes and type the value at two tick marks per axis, then Read again.',
  'cptPdf.overlay.loading': 'Reading the sounding…',
  'cptPdf.overlay.page': 'Page {page}',
  'cptPdf.overlay.panel': 'Panel',
  'cptPdf.overlay.kind': 'Quantity',
  'cptPdf.overlay.kindRead': 'read: {kind}',
  'cptPdf.overlay.valueAxis': 'Value axis ({unit})',
  'cptPdf.overlay.depthAxis': 'Depth axis (m)',
  'cptPdf.overlay.elevationAxis': 'Elevation axis (m TAW)',
  'cptPdf.overlay.tickA': 'Tick A',
  'cptPdf.overlay.tickB': 'Tick B',
  'cptPdf.overlay.eyedropper': 'Pick the curve colour',
  'cptPdf.overlay.eyedropperHint': 'Click the curve on the page',
  'cptPdf.overlay.cornerHandle': 'Drag the {corner} corner of the {kind} frame',
  'cptPdf.overlay.cornerTopLeft': 'top-left',
  'cptPdf.overlay.cornerBottomRight': 'bottom-right',
  'cptPdf.overlay.reset': 'Pick automatically again',
  'cptPdf.overlay.reextract': 'Read again',
  'cptPdf.overlay.use': 'Use this calibration',
  'cptPdf.overlay.back': 'Back to the list',
  'cptPdf.overlay.assumptions': 'Assumptions',
  'cptPdf.overlay.clipped': '{n} point(s) on an axis maximum: kept at the maximum and flagged',
  'cptPdf.overlay.rows': '{n} rows read',
  'cptPdf.overlay.noRows': 'No qc curve read yet: type two tick values per axis, then re-extract.',
  'cptPdf.overlay.header': 'Sheet header',
  'cptPdf.overlay.x': 'X coordinate (m)',
  'cptPdf.overlay.y': 'Y coordinate (m)',
  'cptPdf.overlay.epsg': 'Coordinate system (EPSG)',
  'cptPdf.overlay.groundLevel': 'Ground level (m)',
  'cptPdf.overlay.date': 'Test date',
  'cptPdf.overlay.notPrinted': 'Not printed on the sheet: type it.',
  'cptPdf.overlay.readFailed': 'The sounding could not be read: {message}',
  'cptPdf.report.title': 'Import report',
  'cptPdf.report.status.imported': 'imported',
  'cptPdf.report.status.refreshed': 'replaced',
  'cptPdf.report.status.confirmation_required': 'left unchanged',
  'cptPdf.report.status.refused': 'not imported',
  'cptPdf.report.status.failed': 'failed',
  'cptPdf.report.noIssues': 'no remarks',
  // The import report's remarks, one per backend issue code; the English
  // sentence the backend sent stays the tooltip. {list} is the stretches,
  // each written with ``cptPdf.drilledInterval``.
  'cptPdf.issue.PDF_CLIPPED_POINTS':
    '{count} {curve} point(s) drawn on the axis maximum ({axis_max}): the true value is at least that; kept at the maximum and flagged, never interpolated',
  'cptPdf.issue.PDF_DEPTH_FROM_ELEVATION':
    'Elevation axis: depth = printed ground level ({ground_level_m} m) - plotted elevation',
  'cptPdf.issue.PDF_DRILLED_INTERVALS': 'Drilled without measurement: {list}; left empty, never interpolated',
  'cptPdf.issue.PDF_NO_XY': 'No position on the sheet: type X and Y to place this sounding',
  'cptPdf.issue.PDF_OCR_UNAVAILABLE': 'Read without OCR: the axis values were typed or taken from the grid',
  'cptPdf.toast.none': 'Nothing imported from the report',
} as const
