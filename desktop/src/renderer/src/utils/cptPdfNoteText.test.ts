// The per-row notes of the PDF triage list, in the app language (owner dogfeed
// 2026-10-04): the rows read "22 point(s) on an axis maximum: the true value is
// higher" in English inside the Dutch app. The backend sends each note as a
// stable code + params; the sentence is chosen here, at the presentation
// boundary. A code this build does not know shows the backend's English
// sentence rather than nothing; an older backend that sends no codes at all
// keeps showing its English sentences.
import { describe, expect, it } from 'vitest'

import { translate, type Translator } from '../i18n/translate'
import { cptPdfIssueText, cptPdfNoteText, cptPdfNoteTexts } from './cptPdfNoteText'

const nl: Translator = (key, params) => translate('nl', key, params)
const en: Translator = (key, params) => translate('en', key, params)

describe('cptPdfNoteText: one note in the app language', () => {
  it('N1: a known code reads in Dutch, with its count filled in', () => {
    expect(
      cptPdfNoteText({ code: 'CLIPPED_POINTS', params: { count: 22 } }, 'english fallback', nl),
    ).toBe('22 punt(en) op een asmaximum: de echte waarde ligt hoger')
  })

  it('N2: every code the backend emits has its Dutch sentence', () => {
    expect(cptPdfNoteText({ code: 'TICKS_UNAVAILABLE_NO_OCR', params: {} }, '', nl)).toBe(
      'Schaalwaarden niet afgelezen: typ de aswaarden',
    )
    expect(cptPdfNoteText({ code: 'TICKS_NOT_READ', params: {} }, '', nl)).toBe(
      'Aswaarden niet gelezen: typ twee schaalwaarden per as',
    )
    expect(cptPdfNoteText({ code: 'NO_POSITION_PRINTED', params: {} }, '', nl)).toBe(
      'Geen ligging op het blad: typ X en Y voor het importeren',
    )
    expect(cptPdfNoteText({ code: 'ELEVATION_AXIS', params: {} }, '', nl)).toBe(
      'Hoogte-as: diepte = gedrukt maaiveld min geplotte hoogte',
    )
    expect(cptPdfNoteText({ code: 'ELEVATION_AXIS_NO_GROUND_LEVEL', params: {} }, '', nl)).toBe(
      'Hoogte-as zonder gedrukt maaiveld: typ het maaiveld',
    )
    expect(cptPdfNoteText({ code: 'READ_FROM_IMAGE', params: {} }, '', nl)).toBe(
      'Gelezen uit een afbeelding: vergelijk de oranje curve met het blad',
    )
  })

  it('N2b: a printed coordinate outside its system asks for a check of the header (owner finding 2026-10-08)', () => {
    const note = { code: 'COORDINATE_OUT_OF_RANGE', params: { x: 67592.443, y: 2244433.03, epsg: 31370 } }
    expect(cptPdfNoteText(note, '', nl)).toBe(
      'Coördinaat buiten het bereik van het stelsel (X 67592.443, Y 2244433.03): controleer de hoofding',
    )
    expect(cptPdfNoteText(note, '', en)).toBe(
      'Coordinate outside the range of its system (X 67592.443, Y 2244433.03): check the sheet header',
    )
  })

  it('N3: in English the sentence is the one the backend always wrote', () => {
    expect(cptPdfNoteText({ code: 'CLIPPED_POINTS', params: { count: 3 } }, '', en)).toBe(
      '3 point(s) on an axis maximum: the true value is higher',
    )
    expect(cptPdfNoteText({ code: 'ELEVATION_AXIS', params: {} }, '', en)).toBe(
      'elevation axis: depth = printed ground level - plotted elevation',
    )
  })

  it('N4: an unknown code falls back to the English sentence the backend sent', () => {
    expect(cptPdfNoteText({ code: 'SOMETHING_NEW', params: {} }, 'something new happened', nl)).toBe(
      'something new happened',
    )
  })
})

describe('cptPdfNoteTexts: the notes of one row', () => {
  it('N5: notes are rendered in order, each falling back to the warning at its index', () => {
    expect(
      cptPdfNoteTexts(
        {
          warnings: ['no position printed: type X and Y before importing', 'brand new english'],
          notes: [
            { code: 'NO_POSITION_PRINTED', params: {} },
            { code: 'BRAND_NEW', params: {} },
          ],
        },
        nl,
      ),
    ).toEqual(['Geen ligging op het blad: typ X en Y voor het importeren', 'brand new english'])
  })

  it('N6: an older backend that sends no notes keeps its English warnings', () => {
    expect(cptPdfNoteTexts({ warnings: ['no position printed'] }, nl)).toEqual(['no position printed'])
  })
})

// Owner ruling "a" (2026-10-04): a drilled stretch is shown on the triage row:
// EN "Drilled: {list}" / NL "Overboring: {list}", list = "32.0 tot 32.3 m,
// 40.1 tot 40.9 m" (NL) / "32.0 to 32.3 m, ..." (EN), one decimal.
describe('cptPdfNoteText: drilled intervals', () => {
  const note = { code: 'DRILLED_INTERVALS', params: { intervals: [[32.0, 32.3], [40.12, 40.876]], count: 2 } }

  it('N7: Dutch names every stretch with "tot", one decimal', () => {
    expect(cptPdfNoteText(note, '', nl)).toBe('Overboring: 32.0 tot 32.3 m, 40.1 tot 40.9 m')
  })

  it('N8: English names every stretch with "to", one decimal', () => {
    expect(cptPdfNoteText(note, '', en)).toBe('Drilled: 32.0 to 32.3 m, 40.1 to 40.9 m')
  })

  it('N9: malformed intervals fall back to the English sentence the backend sent', () => {
    expect(
      cptPdfNoteText({ code: 'DRILLED_INTERVALS', params: { intervals: 'x' } }, 'drilled: 1.0 to 1.6 m', nl),
    ).toBe('drilled: 1.0 to 1.6 m')
  })
})

// Owner direction (2026-10-07): when the printed depth axes of two sheets of one
// sounding leave a stretch uncovered, the row says so; it is unknown, not drilled.
// EN "Sheet {n} ends at {d1} m, sheet {n+1} starts at {d2} m: no reading in between"
// NL "Blad {n} eindigt op {d1} m, blad {n+1} begint op {d2} m: geen meting ertussen"
describe('cptPdfNoteText: a stretch no sheet axis covers', () => {
  // The axis depths read to the centimetre, as the backend's English sentence.
  const note = { code: 'SHEET_AXIS_GAP', params: { sheet: 1, next: 2, d1: 33.5, d2: 34.0 } }

  it('N10: Dutch names both sheets and both axis depths', () => {
    expect(cptPdfNoteText(note, '', nl)).toBe(
      'Blad 1 eindigt op 33.50 m, blad 2 begint op 34.00 m: geen meting ertussen',
    )
  })

  it('N11: English names both sheets and both axis depths', () => {
    expect(cptPdfNoteText(note, '', en)).toBe(
      'Sheet 1 ends at 33.50 m, sheet 2 starts at 34.00 m: no reading in between',
    )
  })
})

// The printed-table profile (owner 2026-10-08: "the import takes the EXACT
// printed values from the tables") and its rulings of 2026-10-09: a printed Rf
// that contradicts its own row is dropped (the note says why the cell is
// empty), the floor qc 0,01 rows directly after the voorboring are no reading,
// a CPT-M Qt is stored as q_total unless the sheet names another cone area.
// NL first, plain, no em-dashes; "voorboring" is only the pre-drill from the
// surface.
describe('cptPdfNoteText: a sounding read from its printed table', () => {
  it('N12: every printed-table row note reads in Dutch', () => {
    expect(cptPdfNoteText({ code: 'READ_FROM_PRINTED_TABLE', params: {} }, '', nl)).toBe(
      'Gelezen uit de gedrukte tabel: de waarden zoals gedrukt',
    )
    expect(cptPdfNoteText({ code: 'TABLE_ROWS_REJECTED', params: { count: 2 } }, '', nl)).toBe(
      '2 gedrukte rij(en) niet gelezen',
    )
    expect(cptPdfNoteText({ code: 'TABLE_RF_MISMATCH', params: { count: 1 } }, '', nl)).toBe(
      '1 gedrukte Rf-waarde(n) strijdig met fs / qc: weggelaten, de Rf-cel blijft leeg',
    )
    expect(
      cptPdfNoteText({ code: 'PRE_DRILL_FLOOR_ROWS', params: { count: 6, depth: 2.21 } }, '', nl),
    ).toBe('6 rij(en) met qc 0,01 net onder de voorboring: geen meting, de curve begint op 2.21 m')
  })

  it('N13: in English the row notes are the backend sentences', () => {
    expect(cptPdfNoteText({ code: 'READ_FROM_PRINTED_TABLE', params: {} }, '', en)).toBe(
      'read from the printed table: the values as printed',
    )
    expect(cptPdfNoteText({ code: 'TABLE_RF_MISMATCH', params: { count: 3 } }, '', en)).toBe(
      '3 printed Rf value(s) contradict fs / qc: dropped, the Rf cell empty',
    )
    expect(
      cptPdfNoteText({ code: 'PRE_DRILL_FLOOR_ROWS', params: { count: 6, depth: 2.21 } }, '', en),
    ).toBe('6 row(s) with qc 0.01 directly after the pre-drill: no reading, the curve starts at 2.21 m')
  })
})

describe('cptPdfIssueText: the printed-table import remarks', () => {
  const issue = (code: string, params: Record<string, unknown>) => ({ code, message: 'english', params })

  it('I1: every PDF_TABLE_* issue reads in Dutch', () => {
    expect(cptPdfIssueText(issue('PDF_TABLE_RF_MISMATCH', { count: 3, depths_m: [0.01] }), nl)).toBe(
      '3 gedrukte Rf-waarde(n) strijdig met de gedrukte fs / qc: weggelaten, de Rf-cel leeg gelaten, qc en fs zoals gedrukt',
    )
    expect(cptPdfIssueText(issue('PDF_TABLE_LEVEL_MISMATCH', { count: 1, rows: [[7.01, -0.16]] }), nl)).toBe(
      '1 gedrukte TAW-waarde(n) niet gelijk aan maaiveld min diepte: de diepte zoals gedrukt behouden',
    )
    expect(cptPdfIssueText(issue('PDF_TABLE_ROWS_REJECTED', { count: 2, rows: [] }), nl)).toBe(
      '2 gedrukte rij(en) niet gelezen en niet opgeslagen',
    )
    expect(
      cptPdfIssueText(
        issue('PDF_TABLE_COLUMNS_NOT_IMPORTED', { derived: ["φ'", 'C'], not_stored: ['Inclinatie, °'], columns: ["φ'", 'C', 'Inclinatie, °'] }),
        nl,
      ),
    ).toBe("Gedrukte kolommen niet geïmporteerd (berekend of zonder eigen kolom): φ', C, Inclinatie, °")
    expect(
      cptPdfIssueText(
        issue('PDF_TABLE_PRE_DRILL_FLOOR_ROWS', { count: 6, depths_m: [], pre_drill_m: 1, depth: 2.21 }),
        nl,
      ),
    ).toBe('6 rij(en) met qc 0,01 net onder de voorboring (1 m): geen meting, leeg gelaten; de curve begint op 2.21 m')
    expect(cptPdfIssueText(issue('PDF_TABLE_QTOTAL_CONE_AREA', { area_cm2: 15, column: 'Qt' }), nl)).toBe(
      'Het blad noemt een conus van 15 cm²: de totaalweerstand Qt (kN) is alleen bij de standaardconus van 10 cm² gelijk aan MPa; leeg gelaten, nooit omgerekend',
    )
  })

  it('I2: the English remarks name the same numbers', () => {
    expect(cptPdfIssueText(issue('PDF_TABLE_QTOTAL_CONE_AREA', { area_cm2: 15, column: 'Qt' }), en)).toBe(
      'The sheet names a 15 cm² cone: the total resistance Qt (kN) equals MPa only for the standard 10 cm² cone; left empty, never converted',
    )
    expect(
      cptPdfIssueText(
        issue('PDF_TABLE_PRE_DRILL_FLOOR_ROWS', { count: 6, depths_m: [], pre_drill_m: 1, depth: 2.21 }),
        en,
      ),
    ).toBe('6 row(s) with qc 0.01 directly after the pre-drill (1 m): no reading, left empty; the curve starts at 2.21 m')
  })
})
