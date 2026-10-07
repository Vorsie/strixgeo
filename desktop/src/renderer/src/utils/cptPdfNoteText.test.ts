// The per-row notes of the PDF triage list, in the app language (owner dogfeed
// 2026-10-04): the rows read "22 point(s) on an axis maximum: the true value is
// higher" in English inside the Dutch app. The backend sends each note as a
// stable code + params; the sentence is chosen here, at the presentation
// boundary. A code this build does not know shows the backend's English
// sentence rather than nothing; an older backend that sends no codes at all
// keeps showing its English sentences.
import { describe, expect, it } from 'vitest'

import { translate, type Translator } from '../i18n/translate'
import { cptPdfNoteText, cptPdfNoteTexts } from './cptPdfNoteText'

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
