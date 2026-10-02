/**
 * Read one DOV lithological description into a coded-lithology draft (owner
 * 2026-10-01, "Start from" a description track: "parse the description into
 * codes" + "make sure the person using it checks everything").
 *
 * Rewritten 2026-10-02 after a real contractor-style borehole read 0 of 17
 * layers clause by clause. The reading is now word by word over the WHOLE
 * string (approach and word stock ported from the owner's dov-desktopstudie
 * classifier, see `describedLithologyToCodes_constants.ts`):
 *
 * * the main soil is the first soil NOUN of the layer (zand, klei, silt, leem,
 *   veen, grind, ...) that is not inside a "met ..." phrase and carries no
 *   amount; a grade range "fijn tot middelmatig zand" gives main + second main;
 * * every adjective form (lemige, fijnzandige, veenhoudend, zandrijke, kleiig)
 *   and every later noun (steenfragmenten, houtresten, "met ... klei") is an
 *   admixture with the DOV amount its qualifier names, at most
 *   `MAX_ADMIXTURES_PER_INTERVAL`; an adjective directly before an admixture
 *   noun qualifies that noun ("zandige leembolletjes" = LE, not XZ + LE);
 * * "X- en Y<ending>" gives the ending to both ("leem- en glauconiethoudend");
 * * "plaatselijk" sets the admixture's locally flag until the next comma; a
 *   denial ("niet kalkhoudend", "zonder schelpen", "kalkloos") is a NOTE;
 * * colours in any inflection (grijsbruine = grijsbruin), the first one kept,
 *   later ones noted; consistency and moisture as DOV tokens (not stored by a
 *   coded track) or as notes when DOV has no token (brokkelig, vettig);
 * * "idem" = the layer above, when the caller passes it.
 *
 * Never guess: a word that yields no code goes to ``unmatched`` (in runs, as
 * written), never to a wrong code; an unknown word right before an admixture
 * keeps that admixture out ("bizar silthoudend" stays unmatched). Soil names
 * mapped to the nearest DOV class are listed in ``approximations``. Pure: no
 * I/O, no logging.
 */

import type { AdmixtureResponse } from '../api/clients/borehole'
import {
  AMOUNT_PHRASES,
  COLOUR_PREFIXES,
  CONSISTENCY_FORMS,
  DEFAULT_AMOUNT,
  FEEL_NOTE_FORMS,
  GRADE_PHRASES,
  MAIN_SOIL_NOUNS,
  MOISTURE_FORMS,
  NOUN_PHRASES,
  RICH_AMOUNT,
  type GradedSoil,
} from './describedLithologyToCodes_constants'
import {
  COLOURS,
  FILLERS,
  FRENCH_COLOUR_SET,
  LOCALLY,
  MAX_PHRASE_WORDS,
  MODIFIERS,
  NOTE_SET,
  PHRASE_TABLES,
  SOFT,
  WITH,
  admixtureAdjective,
  admixtureNoun,
  colourLike,
  compoundMainNoun,
  dovColour,
  gradedCode,
  lemma,
  plain,
  sameAsAbove,
  tokenize,
  type Adjective,
  type Grade,
  type SoilApproximation,
  type Token,
} from './describedLithologyWords'
import { MAX_ADMIXTURES_PER_INTERVAL } from './dovTrackCodelists_constants'

export type { SoilApproximation } from './describedLithologyWords'

/** The coded draft of one described interval. */
export interface DescribedLithologyDraft {
  /** The description verbatim, for the check tooltip. */
  source: string
  /** Main soil, then the optional second main soil (DOV hoofdnaam codes). */
  mainSoil: string[]
  /** At most ``MAX_ADMIXTURES_PER_INTERVAL``, in description order. */
  admixtures: AdmixtureResponse[]
  /** DOV colour token, ``''`` when none. */
  color: string
  /** DOV moisture token, ``''`` when none (not stored by a coded track). */
  moisture: string
  /** DOV consistency token, ``''`` when none (not stored by a coded track). */
  consistency: string
  /** Words read but not coded: denials, a second colour, feel words outside
   *  DOV's list, an amount range, "idem", the drilling method. */
  notes: string[]
  /** Everything that produced no code, in runs as written, in order. */
  unmatched: string[]
  /** Soil names mapped to the nearest code, each once. */
  approximations: SoilApproximation[]
}

/** A colour or feel word waiting for the noun (or comma) it belongs to. */
type Quality = { token?: string; note?: string }
/** One word of the pending phrase; ``quality`` words survive an adjective. */
type Piece = { text: string; quality: boolean; grade?: boolean }
interface PendingAdjective {
  code: string
  explicitAmount: string | null
  amount: string
  locally: boolean
  text: string
  range: string | null
  word: string
}

/**
 * Read one DOV lithological description into a coded draft.
 *
 * @param description - The description verbatim (any case / spacing).
 * @param above - The draft of the layer above, so "idem" can take its codes.
 * @returns The draft; ``unmatched`` lists everything that produced no code.
 */
export function parseDescribedLithology(
  description: string,
  above?: DescribedLithologyDraft,
): DescribedLithologyDraft {
  const draft: DescribedLithologyDraft = {
    source: description,
    mainSoil: [],
    admixtures: [],
    color: '',
    moisture: '',
    consistency: '',
    notes: [],
    unmatched: [],
    approximations: [],
  }
  new Reader(draft).read(tokenize(plain(description)), above)
  return draft
}

/** The word-by-word reading behind ``parseDescribedLithology``. */
class Reader {
  private mainFound = false
  /** The bare zand / grind main soil a following grade still grades. */
  private bareMain: GradedSoil | null = null
  private inWith = false
  private withNounSeen = false
  private locally = false
  private run: string[] | null = null
  // The pending phrase: what was read since the last thing it qualified.
  private pieces: Piece[] = []
  private amount: { code: string; at: number } | null = null
  private rangeOpen = false
  private range: string | null = null
  private grades: Grade[] = []
  private negation = false
  private adjectives: PendingAdjective[] = []
  private colours: Quality[] = []
  private feel: Quality[] = []

  constructor(private readonly draft: DescribedLithologyDraft) {}

  read(tokens: Token[], above: DescribedLithologyDraft | undefined): void {
    let i = 0
    const same = sameAsAbove(tokens)
    if (same !== null && above !== undefined && above.mainSoil.length > 0) {
      this.draft.mainSoil = [...above.mainSoil]
      this.draft.admixtures = above.admixtures.map(a => ({ ...a }))
      this.draft.color = above.color
      this.note(same.phrase)
      this.mainFound = true
      i = same.next
    }
    while (i < tokens.length) {
      const tok = tokens[i]
      if (tok.kind === 'note') this.draft.unmatched.push(tok.w)
      else if (tok.kind === 'sep') this.flush(tok.w === '/' ? 'soft' : 'hard')
      else {
        i += this.word(tokens, i)
        continue
      }
      i++
    }
    this.flush('end')
  }

  /** Handle the word at ``i``; returns how many tokens it took. */
  private word(tokens: Token[], i: number): number {
    // Multi-word phrases first, longest first ("zeer sterk" before "sterk").
    for (let n = MAX_PHRASE_WORDS; n >= 1; n--) {
      const words = tokens.slice(i, i + n)
      if (words.length !== n || words.some(t => t.kind !== 'word')) continue
      const phrase = words.map(t => t.w).join(' ')
      if (PHRASE_TABLES.some(t => phrase in t)) {
        this.phrase(phrase)
        return n
      }
    }
    this.single(tokens[i].w)
    return 1
  }

  private phrase(p: string): void {
    if (p in NOUN_PHRASES) return this.noun(p, NOUN_PHRASES[p], false)
    if (p in CONSISTENCY_FORMS) return this.quality(this.feel, p, { token: CONSISTENCY_FORMS[p] })
    if (p in MOISTURE_FORMS) {
      if (this.draft.moisture === '') this.draft.moisture = MOISTURE_FORMS[p]
      else this.note(MOISTURE_FORMS[p])
      return
    }
    if (p in GRADE_PHRASES) {
      this.grades.push({ ...GRADE_PHRASES[p], text: p })
      this.pieces.push({ text: p, quality: false, grade: true })
      return
    }
    if (p in AMOUNT_PHRASES) return this.amountWord(p)
    this.negation = true
    this.push(p)
  }

  private amountWord(p: string): void {
    if (this.rangeOpen && this.amount !== null) {
      // "licht tot plaatselijk sterk": the first amount, the range a note.
      this.push(p)
      this.range = this.pieces.slice(this.amount.at).map(x => x.text).join(' ')
      this.rangeOpen = false
      return
    }
    if (this.amount === null) this.amount = { code: AMOUNT_PHRASES[p], at: this.pieces.length }
    this.push(p)
  }

  private single(w: string): void {
    if (FILLERS.has(w)) return
    if (WITH.has(w)) {
      this.flush('soft')
      this.inWith = true
      this.withNounSeen = false
      return
    }
    if (SOFT.has(w)) return this.flush('soft')
    if (w === 'tot') return this.until()
    if (LOCALLY.has(w)) {
      if (this.rangeOpen) this.push(w)
      else this.locally = true
      return
    }
    if (NOTE_SET.has(w)) return this.note(w)
    const main = MAIN_SOIL_NOUNS[w]
    if (main !== undefined) return this.noun(w, main, true)
    const noun = admixtureNoun(w)
    if (noun !== null) return this.noun(w, noun, false)
    const adjective = admixtureAdjective(w)
    if (adjective !== null) return this.adjective(w, adjective)
    if (w in FEEL_NOTE_FORMS) return this.quality(this.feel, w, { note: FEEL_NOTE_FORMS[w] })
    if (MODIFIERS.has(w)) return this.push(w)
    const colour = dovColour(w)
    if (colour !== null) return this.colour(w, colour)
    if (FRENCH_COLOUR_SET.has(w) || colourLike(w)) return this.quality(this.colours, w, { note: lemma(w) })
    const compound = compoundMainNoun(w)
    if (compound !== null) return this.noun(w, compound, true)
    this.unknown(w)
  }

  /** "tot" joins two grades or two amounts; anything else, it is filler. */
  private until(): void {
    if (this.grades.length > 0) this.pieces.push({ text: 'tot', quality: false, grade: true })
    else if (this.amount !== null) {
      this.push('tot')
      this.rangeOpen = true
    }
  }

  private colour(w: string, token: string): void {
    // "licht grijs" = lichtgrijs, "donker grijs" = donkergrijs.
    const last = this.pieces[this.pieces.length - 1]
    if (last !== undefined && COLOUR_PREFIXES.includes(last.text) && COLOURS.has(`${last.text}${token}`)) {
      if (this.amount !== null && this.amount.at === this.pieces.length - 1) this.amount = null
      last.quality = true
      return this.quality(this.colours, w, { token: `${last.text}${token}` })
    }
    this.quality(this.colours, w, { token })
  }

  private quality(list: Quality[], text: string, q: Quality): void {
    this.pieces.push({ text, quality: true })
    list.push(q)
  }

  private push(text: string): void {
    this.pieces.push({ text, quality: false })
  }

  /** The words of the pending phrase that are not colour / feel words. */
  private plainText(withGrades = true): string[] {
    return this.pieces.filter(p => !p.quality && (withGrades || !p.grade)).map(p => p.text)
  }

  private adjective(w: string, a: Adjective): void {
    this.bareMain = null
    if (a.denies || this.negation) {
      this.note([...this.plainText(), w].join(' '))
      return this.clearPhrase(true)
    }
    if (this.run !== null) return this.unknown(w)
    const { code, approximation } = gradedCode(a.target, this.grades, a.intrinsic)
    if (approximation) this.approximate(approximation)
    const explicit = this.amount?.code ?? null
    // "fijn kalkrijk zand": a grade waits for the graded word it belongs to.
    const graded = typeof a.target !== 'string'
    this.adjectives.push({
      code,
      explicitAmount: explicit,
      amount: explicit ?? (a.rich ? RICH_AMOUNT : DEFAULT_AMOUNT),
      locally: this.locally,
      text: [...this.plainText(), w].join(' '),
      range: this.range,
      word: w,
    })
    this.clearPhrase(true, !graded)
  }

  private noun(w: string, target: string | GradedSoil, mainEligible: boolean): void {
    if (mainEligible && !this.mainFound && !this.inWith && this.amount === null && !this.negation) {
      return this.mainNoun(target)
    }
    this.bareMain = null
    if (this.run !== null && !this.negation) return this.unknown(w)
    const text = [...this.adjectives.map(a => a.text), ...this.pieces.map(p => p.text), w].join(' ')
    if (this.negation) this.note(text)
    else {
      const { code, approximation } = gradedCode(target, this.grades)
      if (approximation) this.approximate(approximation)
      const amount = this.amount?.code ?? this.adjectives.find(a => a.explicitAmount)?.explicitAmount ?? DEFAULT_AMOUNT
      this.addAdmixture(code, amount, this.locally, text, this.range, w)
    }
    if (this.inWith) this.withNounSeen = true
    // The adjectives, colours and feel words in front qualified this noun.
    this.adjectives = []
    this.colours = []
    this.feel = []
    this.clearPhrase(false)
  }

  private mainNoun(target: string | GradedSoil): void {
    this.closeRun()
    const codes: string[] = []
    if (typeof target === 'string') codes.push(target)
    else if (this.grades.length === 0) codes.push(target.X)
    else {
      for (const g of this.grades.slice(0, 2)) {
        const { code, approximation } = gradedCode(target, [g])
        if (approximation) this.approximate(approximation)
        if (!codes.includes(code)) codes.push(code)
      }
    }
    this.draft.mainSoil = codes
    this.mainFound = true
    this.bareMain = typeof target !== 'string' && this.grades.length === 0 ? target : null
    this.commitAdjectives()
    this.commitQualities()
    this.clearPhrase(false)
  }

  /** A word with no code: it, and what was waiting for it, is "not matched". */
  private unknown(w: string): void {
    this.bareMain = null
    this.run = this.run ?? []
    this.run.push(...this.adjectives.map(a => a.text), ...this.plainText(), w)
    this.adjectives = []
    this.clearPhrase(true)
  }

  private closeRun(): void {
    if (this.run !== null && this.run.length > 0) this.draft.unmatched.push(this.run.join(' '))
    this.run = null
  }

  private flush(kind: 'soft' | 'hard' | 'end'): void {
    // A "met" phrase lasts until its noun: "met blauwgrijze, vettige slappe klei".
    if (kind !== 'end' && this.inWith && !this.withNounSeen) return this.closeRun()
    // NEN "Zand, zeer fijn" / French "sable fin": a grade after a bare noun.
    if (this.bareMain !== null && this.grades.length > 0) {
      const { code, approximation } = gradedCode(this.bareMain, this.grades)
      if (approximation) this.approximate(approximation)
      this.draft.mainSoil = [code]
      this.grades = []
      this.pieces = this.pieces.filter(p => p.quality)
    }
    // "Zand, zeer fijn": the comma right after the bare noun keeps it open.
    const emptyPhrase = this.pieces.length === 0 && this.adjectives.length === 0 && this.colours.length === 0
    if (!emptyPhrase || kind === 'end') this.bareMain = null
    this.commitAdjectives()
    this.commitQualities()
    // An amount with nothing to qualify: shown, not dropped.
    if (this.amount !== null) (this.run = this.run ?? []).push(...this.plainText())
    this.closeRun()
    this.clearPhrase(false)
    if (kind !== 'soft') {
      this.locally = false
      this.inWith = false
      this.withNounSeen = false
    }
  }

  private commitAdjectives(): void {
    for (const a of this.adjectives) this.addAdmixture(a.code, a.amount, a.locally, a.text, a.range, a.word)
    this.adjectives = []
  }

  private commitQualities(): void {
    for (const c of this.colours) {
      if (c.token !== undefined && this.draft.color === '') this.draft.color = c.token
      else this.note(c.token ?? c.note ?? '')
    }
    for (const f of this.feel) {
      if (f.token !== undefined && this.draft.consistency === '') this.draft.consistency = f.token
      else this.note(f.token ?? f.note ?? '')
    }
    this.colours = []
    this.feel = []
  }

  private addAdmixture(
    code: string,
    amount: string,
    locally: boolean,
    text: string,
    range: string | null,
    word: string,
  ): void {
    if (this.draft.admixtures.some(a => a.soil_code === code)) return
    if (this.draft.admixtures.length >= MAX_ADMIXTURES_PER_INTERVAL) {
      this.draft.unmatched.push(text)
      return
    }
    this.draft.admixtures.push({ soil_code: code, amount, locally })
    if (range !== null) this.note(`${range} ${lemma(word)}`)
  }

  private approximate(a: SoilApproximation): void {
    if (!this.draft.approximations.some(x => x.phrase === a.phrase)) this.draft.approximations.push(a)
  }

  private note(text: string): void {
    if (text !== '' && !this.draft.notes.includes(text)) this.draft.notes.push(text)
  }

  /**
   * Forget the pending amount, grades and words; ``keepQualities`` leaves the
   * colour / feel words for the noun still to come, ``keepGrades`` the grade
   * for a graded word still to come.
   */
  private clearPhrase(keepQualities: boolean, keepGrades = false): void {
    const grades = this.grades
    this.pieces = this.pieces.filter(p => (keepQualities && p.quality) || (keepGrades && p.grade === true))
    this.amount = null
    this.range = null
    this.rangeOpen = false
    this.grades = keepGrades ? grades : []
    this.negation = false
  }
}
