// "Start from" a DOV lithological DESCRIPTION into a coded lithology (owner
// 2026-10-01): "parse the description into codes" and "make sure the person
// using it checks everything". Pinned in the ruling's words:
// * one Dutch DOV description becomes a coded draft: main soil, an optional
//   second main soil, up to 3 admixtures with their DOV amount, the colour, and
//   the moisture / consistency when the DOV lists carry them;
// * never guess: a clause that produces no code goes to `unmatched`, never to a
//   wrong code; the verbatim description travels along as `source`;
// * a grade range "zeer fijn tot fijn zand" = the FIRST named grade is the main
//   soil, the other the second main soil (one code when both are the same).
//
// The four descriptions are real (the owner's borehole, 2026-10-01).
import { describe, expect, it } from 'vitest'

import { parseDescribedLithology } from './describedLithologyToCodes'

describe('parseDescribedLithology — the owner\'s four descriptions', () => {
  it('silt with very strongly very-fine-sand admixture, stone fragments, calcareous, plastic, brown, moist', () => {
    const source =
      'silt, zeer sterk zeer fijn zandhoudend, steenfragmenten (tot 20mm), kalkhoudend, plastisch, bruin, vochtig'
    const d = parseDescribedLithology(source)
    expect(d.source).toBe(source)
    expect(d.mainSoil).toEqual(['SI'])
    expect(d.admixtures).toEqual([
      // "zeer fijn zand" has no own DOV code: FZ (fijn zand) is the finest sand code.
      { soil_code: 'FZ', amount: 'S', locally: false },
      // "steenfragmenten" IS a DOV hoofdnaam (SN); bare noun = DOV's "met" step N.
      { soil_code: 'SN', amount: 'N', locally: false },
      // "kalk" is a DOV hoofdnaam (KA); bare "-houdend" = N.
      { soil_code: 'KA', amount: 'N', locally: false },
    ])
    expect(d.color).toBe('bruin')
    expect(d.moisture).toBe('vochtig')
    expect(d.consistency).toBe('plastisch')
    // The size note of the stone fragments is not a code: listed, not dropped.
    expect(d.unmatched).toEqual(['(tot 20mm)'])
    // A mapping without an exact DOV code is named, so the check can see it.
    expect(d.approximations).toEqual([{ phrase: 'zeer fijn zand', code: 'FZ' }])
  })

  it('very fine sand, strongly silty, calcareous, brown, moist', () => {
    const d = parseDescribedLithology('zeer fijn zand, sterk silthoudend, kalkhoudend, bruin, vochtig')
    expect(d.mainSoil).toEqual(['FZ'])
    expect(d.admixtures).toEqual([
      { soil_code: 'SI', amount: 'V', locally: false },
      { soil_code: 'KA', amount: 'N', locally: false },
    ])
    expect(d.color).toBe('bruin')
    expect(d.moisture).toBe('vochtig')
    expect(d.unmatched).toEqual([])
  })

  it('clay, strongly very-fine-sandy, slightly calcareous, plastic, grey-brown, moist', () => {
    const d = parseDescribedLithology(
      'klei, sterk zeer fijn zandhoudend, licht kalkhoudend, plastisch, grijsbruin, vochtig',
    )
    expect(d.mainSoil).toEqual(['KL'])
    expect(d.admixtures).toEqual([
      { soil_code: 'FZ', amount: 'V', locally: false },
      { soil_code: 'KA', amount: 'W', locally: false },
    ])
    // A compound colour is matched as itself when the DOV list has it.
    expect(d.color).toBe('grijsbruin')
    expect(d.consistency).toBe('plastisch')
    expect(d.unmatched).toEqual([])
  })

  it('a grade range: the first named grade is the main soil; clay lenses are not a DOV code', () => {
    const d = parseDescribedLithology(
      'zeer fijn tot fijn zand, sterk silthoudend, kleilenzen, kalkhoudend, groengrijs, zeer vochtig',
    )
    // zeer fijn -> FZ, fijn -> FZ: one code, not FZ twice.
    expect(d.mainSoil).toEqual(['FZ'])
    expect(d.admixtures).toEqual([
      { soil_code: 'SI', amount: 'V', locally: false },
      { soil_code: 'KA', amount: 'N', locally: false },
    ])
    expect(d.color).toBe('groengrijs')
    expect(d.moisture).toBe('zeer vochtig')
    expect(d.unmatched).toEqual(['kleilenzen'])
    expect(d.approximations).toEqual([{ phrase: 'zeer fijn zand', code: 'FZ' }])
  })
})

describe('parseDescribedLithology — boundaries', () => {
  it('a range of two different grades: first = main soil, second = second main soil', () => {
    const d = parseDescribedLithology('middelmatig tot fijn zand, glauconiethoudend')
    expect(d.mainSoil).toEqual(['MZ', 'FZ'])
    expect(d.admixtures).toEqual([{ soil_code: 'GL', amount: 'N', locally: false }])
  })

  it('the five DOV amount steps from their words', () => {
    const amount = (word: string) =>
      parseDescribedLithology(`klei, ${word} silthoudend`).admixtures[0]?.amount
    expect(amount('sporadisch')).toBe('Z')
    expect(amount('weinig')).toBe('W')
    expect(amount('matig')).toBe('M')
    expect(amount('sterk')).toBe('V')
    expect(amount('zeer sterk')).toBe('S')
  })

  it('a description with no known word yields no code, every clause unmatched', () => {
    const d = parseDescribedLithology('opgevuld gat, wortels, idem')
    expect(d.mainSoil).toEqual([])
    expect(d.admixtures).toEqual([])
    expect(d.color).toBe('')
    expect(d.moisture).toBe('')
    expect(d.consistency).toBe('')
    expect(d.unmatched).toEqual(['opgevuld gat', 'wortels', 'idem'])
  })

  it('an empty description yields an empty draft', () => {
    const d = parseDescribedLithology('   ')
    expect(d.mainSoil).toEqual([])
    expect(d.admixtures).toEqual([])
    expect(d.unmatched).toEqual([])
    expect(d.source).toBe('   ')
  })

  it('never more than 3 admixtures: a fourth is listed as unmatched, not dropped', () => {
    const d = parseDescribedLithology('klei, silthoudend, kalkhoudend, glauconiethoudend, veenhoudend')
    expect(d.admixtures.map(a => a.soil_code)).toEqual(['SI', 'KA', 'GL'])
    expect(d.unmatched).toEqual(['veenhoudend'])
  })

  it('an unknown amount word is not guessed: the clause stays unmatched', () => {
    const d = parseDescribedLithology('klei, enigszins silthoudend')
    expect(d.admixtures).toEqual([])
    expect(d.unmatched).toEqual(['enigszins silthoudend'])
  })
})
