// Boringen uit een pdf-rapport: triagelijst, de twee bevestigingen (X/Y zonder
// stelsel, grondwaterstand zonder eenheid) en de import.
// WIRED: BoreholePdfImportDialog, BoreholePdfTriageList, BoreholePdfQuestions
// en useBoreholePdfImport lezen deze sleutels.
//
// Part of the Dutch (BE) message catalogue — see 'locales/nl/index.ts'.

export const BOREHOLE_PDF_NL = {
  'boreholePdf.title': 'Boringen uit een pdf-rapport',
  'boreholePdf.pickerFilter': 'Pdf-rapporten',
  'boreholePdf.uploading': 'Het rapport wordt opgeladen…',
  'boreholePdf.starting': 'Bezig met starten…',
  'boreholePdf.phase.classify': 'Pagina’s lezen ({done}/{total})…',
  'boreholePdf.phase.digitise': 'Boorstaten lezen ({done}/{total})…',
  'boreholePdf.phase.ocr': 'Pagina’s lezen met OCR ({done}/{total})…',
  'boreholePdf.failed': 'Het rapport kon niet gelezen worden: {message}',
  'boreholePdf.summary': '{n} boringen gevonden',
  'boreholePdf.none': 'Geen boorstaten gevonden in dit rapport.',
  'boreholePdf.ocrUnavailable':
    '{n} pagina(’s) zonder tekstlaag niet gelezen: gescande pagina’s vragen de OCR-uitbreiding.',
  'boreholePdf.pages': 'blz. {pages}',
  'boreholePdf.depth': '{top} tot {base} m',
  'boreholePdf.groundLevel': 'maaiveld {z} m',
  'boreholePdf.noPosition': 'geen positie',
  'boreholePdf.counts': '{layers} lagen, {samples} monsters',
  'boreholePdf.water': 'grondwater {depth} m onder maaiveld',
  'boreholePdf.readByOcr': 'gelezen met OCR',
  'boreholePdf.notParsed': 'lay-out niet gekend: niet te importeren',
  'boreholePdf.notImportable': 'niet te importeren: geen positie of maaiveldhoogte',
  'boreholePdf.repeatOf': 'tweede afdruk van {other}: vink er maar één aan',
  'boreholePdf.thumbnailAlt': 'Pagina {page} van het rapport',
  'boreholePdf.crs.question': 'X/Y zonder coördinatenstelsel gedrukt:',
  'boreholePdf.crs.this': 'Deze boring is Lambert 72',
  'boreholePdf.crs.report': 'Alle boringen in dit rapport zijn Lambert 72',
  'boreholePdf.crs.other': 'Ander stelsel',
  'boreholePdf.crs.otherLabel': 'Coördinatenstelsel',
  'boreholePdf.water.question': 'Grondwaterstand {value} zonder eenheid gedrukt:',
  'boreholePdf.water.confirm': 'cm onder maaiveld ({depth} m)',
  'boreholePdf.mustConfirm': '{n} aangevinkte boring(en) wachten nog op een bevestiging.',
  'boreholePdf.repeatTicked': 'Twee afdrukken van dezelfde boring zijn aangevinkt: vink er één uit.',
  'boreholePdf.droppedHeading': 'Weggelaten ({n})',
  'boreholePdf.droppedRepeat': '{name} (blz. {pages}): tweede afdruk met exact dezelfde gegevens',
  'boreholePdf.selectAll': 'Alles selecteren',
  'boreholePdf.selectNone': 'Niets selecteren',
  'boreholePdf.importSelected': 'Selectie importeren ({n})',
  'boreholePdf.importing': 'Bezig met importeren…',
  'boreholePdf.refused': 'Import geweigerd: {message}',
  'boreholePdf.toast.none': 'Geen boringen geïmporteerd uit het rapport',
} as const
