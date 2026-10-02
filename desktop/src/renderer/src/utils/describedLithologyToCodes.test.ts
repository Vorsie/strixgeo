// "Start from" a DOV lithological DESCRIPTION into a coded lithology (owner
// 2026-10-01): "parse the description into codes" and "make sure the person
// using it checks everything". Rewritten 2026-10-02 after the owner tried it
// on a real borehole (GEO-25/110-B1, 17 described layers in contractor style)
// and got "0 matches": the reading is now word by word over the WHOLE string,
// not clause by clause. Pinned in the rulings' words:
// * the main soil is the soil NOUN (zand, klei, silt, leem, veen, grind, ...),
//   never an adjective form: lemige / fijnzandige / veenhoudend / zandrijke are
//   admixtures of the layer, with the DOV amount their qualifier names;
// * a grade range "fijn tot middelmatig zand" = the first grade is the main
//   soil, the second the second main soil;
// * "X- en Y<ending>" carries the shared ending to both: "leem- en
//   glauconiethoudend" = leemhoudend + glauconiethoudend;
// * "plaatselijk" sets the admixture's locally flag; "niet kalkhoudend" is NOT
//   an admixture (it is a note);
// * a colour is read in any inflection (grijsbruine = grijsbruin); a second
//   colour is a note, not lost;
// * never guess: what produces no code is listed as "not matched", never
//   turned into a wrong code; at most 3 admixtures, the rest listed.
import { describe, expect, it } from 'vitest'

import { parseDescribedLithology } from './describedLithologyToCodes'

const adm = (soil_code: string, amount: string, locally = false) => ({ soil_code, amount, locally })

describe('parseDescribedLithology — the DOV lab style keeps working', () => {
  it('silt with very strongly very-fine-sand admixture, stone fragments, calcareous, plastic, brown, moist', () => {
    const source =
      'silt, zeer sterk zeer fijn zandhoudend, steenfragmenten (tot 20mm), kalkhoudend, plastisch, bruin, vochtig'
    const d = parseDescribedLithology(source)
    expect(d.source).toBe(source)
    expect(d.mainSoil).toEqual(['SI'])
    // "zeer fijn zand" has no own DOV code: FZ (fijn zand) is the finest sand
    // code; "steenfragmenten" IS a DOV hoofdnaam (SN); bare "-houdend" = N.
    expect(d.admixtures).toEqual([adm('FZ', 'S'), adm('SN', 'N'), adm('KA', 'N')])
    expect(d.color).toBe('bruin')
    expect(d.moisture).toBe('vochtig')
    expect(d.consistency).toBe('plastisch')
    // The size note of the stone fragments is not a code: listed, not dropped.
    expect(d.unmatched).toEqual(['(tot 20mm)'])
    expect(d.approximations).toEqual([{ phrase: 'zeer fijn zand', code: 'FZ' }])
  })

  it('very fine sand, strongly silty, calcareous, brown, moist', () => {
    const d = parseDescribedLithology('zeer fijn zand, sterk silthoudend, kalkhoudend, bruin, vochtig')
    expect(d.mainSoil).toEqual(['FZ'])
    expect(d.admixtures).toEqual([adm('SI', 'V'), adm('KA', 'N')])
    expect(d.color).toBe('bruin')
    expect(d.moisture).toBe('vochtig')
    expect(d.unmatched).toEqual([])
  })

  it('clay, strongly very-fine-sandy, slightly calcareous, plastic, grey-brown, moist', () => {
    const d = parseDescribedLithology(
      'klei, sterk zeer fijn zandhoudend, licht kalkhoudend, plastisch, grijsbruin, vochtig',
    )
    expect(d.mainSoil).toEqual(['KL'])
    expect(d.admixtures).toEqual([adm('FZ', 'V'), adm('KA', 'W')])
    expect(d.color).toBe('grijsbruin')
    expect(d.consistency).toBe('plastisch')
    expect(d.unmatched).toEqual([])
  })

  it("a grade range of one code; clay lenses ARE coded KL by DOV's own coders", () => {
    const d = parseDescribedLithology(
      'zeer fijn tot fijn zand, sterk silthoudend, kleilenzen, kalkhoudend, groengrijs, zeer vochtig',
    )
    // zeer fijn -> FZ, fijn -> FZ: one code, not FZ twice.
    expect(d.mainSoil).toEqual(['FZ'])
    // Cache: 28 of 28 layers describing "kleilenzen" carry a KL admixture.
    expect(d.admixtures).toEqual([adm('SI', 'V'), adm('KL', 'N'), adm('KA', 'N')])
    expect(d.color).toBe('groengrijs')
    expect(d.moisture).toBe('zeer vochtig')
    expect(d.unmatched).toEqual([])
  })
})

// The owner's real borehole (GEO-25/110-B1, 2026-10-02), one case per layer.
// Expected values are the reading a geotechnician gives the sentence.
describe("parseDescribedLithology — the owner's 17 contractor-style layers", () => {
  const read = parseDescribedLithology

  it('1. sand range, loam- and glauconite-bearing, stone fragments; "niet kalkhoudend" is a note', () => {
    const d = read(
      'bruin, leem- en glauconiethoudend, slecht gesorteerd, fijn tot middelmatig zand met redelijk wat steenfragmenten, weinig afgeronde grove tot zeer grove korrels en weinig fijne baksteenresten, niet kalkhoudend',
    )
    expect(d.mainSoil).toEqual(['FZ', 'MZ'])
    expect(d.admixtures).toEqual([adm('LE', 'N'), adm('GL', 'N'), adm('SN', 'M')])
    expect(d.color).toBe('bruin')
    expect(d.notes).toEqual(['niet kalkhoudend'])
    // The fourth admixture (brick) is over the limit of 3: listed, not lost.
    expect(d.unmatched).toEqual([
      'slecht gesorteerd',
      'weinig afgeronde grove tot zeer grove korrels',
      'weinig fijne baksteenresten',
    ])
  })

  it('2. sand range with gravel fragments, brick remains and a few sandy loam balls', () => {
    const d = read(
      'fijn tot middelmatig zand met weinig afgeronde grove tot zeer grove korrels en grindfragmentjes, weinig fijne baksteenresten en enkele zandige leembolletjes',
    )
    expect(d.mainSoil).toEqual(['FZ', 'MZ'])
    // "zandige" qualifies the loam balls, not the layer: no XZ admixture.
    expect(d.admixtures).toEqual([adm('XG', 'N'), adm('BK', 'W'), adm('LE', 'W')])
    expect(d.unmatched).toEqual(['weinig afgeronde grove tot zeer grove korrels'])
  })

  it('3. "some stone and brick fragments": no soil noun, so no main soil (never guessed)', () => {
    const d = read('wat steen- en fijne baksteenfragmenten')
    expect(d.mainSoil).toEqual([])
    expect(d.admixtures).toEqual([adm('SN', 'W'), adm('BK', 'N')])
    expect(d.unmatched).toEqual([])
  })

  it('4. two colours (first kept, second a note), loamy slightly fine-sandy soft clay with wood', () => {
    const d = read(
      'bruin- en blauwgrijze, lemige en licht fijnzandige slappe klei met grove houtresten en fijnere zwarte veenresten',
    )
    expect(d.mainSoil).toEqual(['KL'])
    expect(d.admixtures).toEqual([adm('LE', 'N'), adm('FZ', 'W'), adm('HT', 'N')])
    expect(d.color).toBe('bruingrijs')
    expect(d.consistency).toBe('slap')
    expect(d.notes).toEqual(['blauwgrijs'])
    expect(d.unmatched).toEqual(['fijnere zwarte veenresten'])
  })

  it('5. strongly fine-to-medium sandy clay: the first grade of the admixture range', () => {
    const d = read(
      'sterk fijn tot middelzandige slappe en brokkelige, lemige klei met redelijk wat plantenwortels en wat houtresten',
    )
    expect(d.mainSoil).toEqual(['KL'])
    expect(d.admixtures).toEqual([adm('FZ', 'V'), adm('LE', 'N'), adm('PL', 'M')])
    expect(d.consistency).toBe('slap')
    expect(d.notes).toEqual(['brokkelig'])
    expect(d.unmatched).toEqual(['wat houtresten'])
  })

  it('6. slightly fine-sandy and loamy, soft and crumbly clay with some roots', () => {
    const d = read('licht fijnzandige en lemige, slappe en brokkelige klei met wat plantenwortels')
    expect(d.mainSoil).toEqual(['KL'])
    expect(d.admixtures).toEqual([adm('FZ', 'W'), adm('LE', 'N'), adm('PL', 'W')])
    expect(d.consistency).toBe('slap')
    expect(d.notes).toEqual(['brokkelig'])
    expect(d.unmatched).toEqual([])
  })

  it('7. sporadic roots = Z; "heel fijn" grades the mica, it is not an amount', () => {
    const d = read(
      'licht fijnzandige en lemige slappe klei, sporadisch plantenwortels en heel fijn glimmerhoudend',
    )
    expect(d.mainSoil).toEqual(['KL'])
    expect(d.admixtures).toEqual([adm('FZ', 'W'), adm('LE', 'N'), adm('PL', 'Z')])
    expect(d.unmatched).toEqual(['heel fijn glimmerhoudend'])
  })

  it('8. slightly fine-sandy soft clay', () => {
    const d = read('licht fijnzandige slappe klei')
    expect(d.mainSoil).toEqual(['KL'])
    expect(d.admixtures).toEqual([adm('FZ', 'W')])
    expect(d.consistency).toBe('slap')
    expect(d.unmatched).toEqual([])
  })

  it('9. an amount range "licht tot plaatselijk sterk": the first amount, the range a note', () => {
    const d = read('licht tot plaatselijk sterk fijnzandige slappe klei')
    expect(d.mainSoil).toEqual(['KL'])
    expect(d.admixtures).toEqual([adm('FZ', 'W')])
    expect(d.notes).toEqual(['licht tot plaatselijk sterk fijnzandig'])
    expect(d.unmatched).toEqual([])
  })

  it('10. peat remains, roots and mica: three admixtures, the rest listed', () => {
    const d = read(
      'licht fijnzandige en lemige slappe klei met wat fijne veenresten, plantenwortels en heel fijn glimmerhoudend',
    )
    expect(d.mainSoil).toEqual(['KL'])
    expect(d.admixtures).toEqual([adm('FZ', 'W'), adm('LE', 'N'), adm('VE', 'W')])
    expect(d.unmatched).toEqual(['plantenwortels', 'heel fijn glimmerhoudend'])
  })

  it('11. sporadically fine-sandy soft clay, very finely micaceous', () => {
    const d = read('sporadisch fijnzandige slappe klei, heel fijn glimmerhoudend')
    expect(d.mainSoil).toEqual(['KL'])
    expect(d.admixtures).toEqual([adm('FZ', 'Z'), adm('GI', 'N')])
    expect(d.unmatched).toEqual([])
  })

  it('12. "redelijk sterk" = MV; "plaatselijk klei- en ... glimmerhoudend" = both locally', () => {
    const d = read(
      'grijsbruin, redelijk sterk veenhoudend brokkelig silt, plaatselijk klei- en heel fijn glimmerhoudend',
    )
    expect(d.mainSoil).toEqual(['SI'])
    expect(d.admixtures).toEqual([adm('VE', 'MV'), adm('KL', 'N', true), adm('GI', 'N', true)])
    expect(d.color).toBe('grijsbruin')
    expect(d.notes).toEqual(['brokkelig'])
    expect(d.unmatched).toEqual([])
  })

  it('13. black-brown, strongly peaty crumbly silt', () => {
    const d = read('zwartbruin, sterk veenhoudend brokkelig silt')
    expect(d.mainSoil).toEqual(['SI'])
    expect(d.admixtures).toEqual([adm('VE', 'V')])
    expect(d.color).toBe('zwartbruin')
    expect(d.notes).toEqual(['brokkelig'])
  })

  it('14. an inflected colour (grijsbruine = grijsbruin), strongly fine-sandy loam', () => {
    const d = read('grijsbruine, sterk fijnzandige leem met wat veenresten')
    expect(d.mainSoil).toEqual(['LE'])
    expect(d.admixtures).toEqual([adm('FZ', 'V'), adm('VE', 'W')])
    expect(d.color).toBe('grijsbruin')
    expect(d.unmatched).toEqual([])
  })

  it('15. "veen- en zandrijke" = peat-rich and sand-rich: -rijk = V', () => {
    const d = read('veen- en zandrijke brokkelige leem')
    expect(d.mainSoil).toEqual(['LE'])
    expect(d.admixtures).toEqual([adm('VE', 'V'), adm('XZ', 'V')])
    expect(d.notes).toEqual(['brokkelig'])
  })

  it('16. the clay after "met" is an admixture; its colour and feel stay with it', () => {
    const d = read('sterk fijnzandige leem met blauwgrijze, vettige slappe klei')
    expect(d.mainSoil).toEqual(['LE'])
    expect(d.admixtures).toEqual([adm('FZ', 'V'), adm('KL', 'N')])
    expect(d.color).toBe('')
    expect(d.consistency).toBe('')
    expect(d.unmatched).toEqual([])
  })

  it('17. a quartz sand range, glauconite-bearing, with coarse black wood', () => {
    const d = read('groengrijs, middelmatig tot grof kwartszand, glauconiethoudend en met grove zwarte houtresten')
    expect(d.mainSoil).toEqual(['MZ', 'GZ'])
    expect(d.admixtures).toEqual([adm('GL', 'N'), adm('HT', 'N')])
    expect(d.color).toBe('groengrijs')
    expect(d.unmatched).toEqual([])
  })
})

describe('parseDescribedLithology — boundaries', () => {
  it('a range of two different grades: first = main soil, second = second main soil', () => {
    const d = parseDescribedLithology('middelmatig tot fijn zand, glauconiethoudend')
    expect(d.mainSoil).toEqual(['MZ', 'FZ'])
    expect(d.admixtures).toEqual([adm('GL', 'N')])
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

  it('the NEN style puts the grade after the noun: "Zand, zeer fijn, matig siltig"', () => {
    const d = parseDescribedLithology('Zand, zeer fijn, matig siltig, zwak schelphoudend, donkergrijs. Pulsboor')
    expect(d.mainSoil).toEqual(['FZ'])
    expect(d.admixtures).toEqual([adm('SI', 'M'), adm('SC', 'W')])
    expect(d.color).toBe('donkergrijs')
  })

  it('a denial is a note, never an admixture: geen / zonder / -loos', () => {
    const d = parseDescribedLithology('grijze klei zonder schelpen, kalkloos, geen glauconiet')
    expect(d.mainSoil).toEqual(['KL'])
    expect(d.admixtures).toEqual([])
    expect(d.color).toBe('grijs')
    expect(d.notes).toEqual(['zonder schelpen', 'kalkloos', 'geen glauconiet'])
  })

  it('"idem" takes the main soil of the layer above when one is given, with a note', () => {
    const above = parseDescribedLithology('grijs fijn zand, glauconiethoudend')
    const d = parseDescribedLithology('idem, met brokjes veen', above)
    expect(d.mainSoil).toEqual(['FZ'])
    expect(d.admixtures).toEqual([adm('GL', 'N'), adm('VE', 'N')])
    expect(d.notes).toEqual(['idem'])
    // Without a layer above "idem" says nothing that can be coded.
    const alone = parseDescribedLithology('idem')
    expect(alone.mainSoil).toEqual([])
    expect(alone.unmatched).toEqual(['idem'])
  })

  it('a description with no known word yields no code, everything unmatched', () => {
    const d = parseDescribedLithology('opgevuld gat, idem')
    expect(d.mainSoil).toEqual([])
    expect(d.admixtures).toEqual([])
    expect(d.color).toBe('')
    expect(d.moisture).toBe('')
    expect(d.consistency).toBe('')
    expect(d.unmatched).toEqual(['opgevuld gat', 'idem'])
  })

  it('an empty description yields an empty draft', () => {
    const d = parseDescribedLithology('   ')
    expect(d.mainSoil).toEqual([])
    expect(d.admixtures).toEqual([])
    expect(d.unmatched).toEqual([])
    expect(d.notes).toEqual([])
    expect(d.source).toBe('   ')
  })

  it('never more than 3 admixtures: a fourth is listed as unmatched, not dropped', () => {
    const d = parseDescribedLithology('klei, silthoudend, kalkhoudend, glauconiethoudend, veenhoudend')
    expect(d.admixtures.map(a => a.soil_code)).toEqual(['SI', 'KA', 'GL'])
    expect(d.unmatched).toEqual(['veenhoudend'])
  })

  it('an unknown word right before an admixture is not guessed away: the phrase stays unmatched', () => {
    const d = parseDescribedLithology('klei, bizar silthoudend')
    expect(d.mainSoil).toEqual(['KL'])
    expect(d.admixtures).toEqual([])
    expect(d.unmatched).toEqual(['bizar silthoudend'])
  })

  it('the French of the older records: the matrix and its -eux admixtures', () => {
    const d = parseDescribedLithology('sable gris foncé argileux')
    expect(d.mainSoil).toEqual(['XZ'])
    expect(d.admixtures).toEqual([adm('KL', 'N')])
  })
})
