/**
 * Read one Dutch DOV lithological description into a coded-lithology draft
 * (owner 2026-10-01, "Start from" a description track: "parse the description
 * into codes" + "make sure the person using it checks everything").
 *
 * DOV descriptions of the comma style ("klei, sterk zeer fijn zandhoudend,
 * licht kalkhoudend, plastisch, grijsbruin, vochtig") are read clause by clause:
 *
 * * the FIRST clause is the main soil, matched against the DOV hoofdnaam names
 *   (`SOIL_COLORS[code].source`). A grade range "<g1> tot <g2> <soil>" gives
 *   the FIRST named grade as main soil and the other as second main soil (one
 *   code when both name the same code);
 * * every other clause is, in this order: a DOV colour token, a DOV moisture
 *   token, a DOV consistency token, an admixture adjective "[amount]
 *   <soil>houdend", or an admixture noun "[amount] <soil>" (at most
 *   `MAX_ADMIXTURES_PER_INTERVAL`);
 * * a parenthesised note ("(tot 20mm)") is cut out of its clause and listed.
 *
 * Never guess: a clause that yields nothing goes to ``unmatched`` verbatim,
 * never to a wrong code. A soil name with no exact DOV code that is mapped to
 * the nearest one is listed in ``approximations``. Pure: no I/O, no logging.
 */

import type { AdmixtureResponse } from '../api/clients/borehole'
import {
  DESCRIPTION_ADMIXTURE_SUFFIX,
  DESCRIPTION_AMOUNT_WORDS,
  DESCRIPTION_DEFAULT_AMOUNT,
  DESCRIPTION_GRADE_WORDS,
  DESCRIPTION_RANGE_WORD,
  DESCRIPTION_SOIL_APPROXIMATIONS,
} from './describedLithologyToCodes_constants'
import {
  DOV_COLOUR_TOKENS,
  DOV_CONSISTENCY_TOKENS,
  DOV_MOISTURE_TOKENS,
  MAX_ADMIXTURES_PER_INTERVAL,
} from './dovTrackCodelists_constants'
import { SOIL_COLORS } from './soilColors'

/** A soil name mapped to the nearest DOV code because it has none of its own. */
export interface SoilApproximation {
  phrase: string
  code: string
}

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
  /** Every clause (or note) that produced no code, normalised, in order. */
  unmatched: string[]
  /** Soil names mapped to the nearest code, each once. */
  approximations: SoilApproximation[]
}

/** DOV hoofdnaam name (lower case) -> code, from the 127-code list. */
const SOIL_BY_NAME: ReadonlyMap<string, string> = new Map(
  Object.entries(SOIL_COLORS)
    .filter(([, style]) => style.source !== undefined)
    .map(([code, style]) => [(style.source as string).toLowerCase(), code]),
)
const COLOURS = new Set(DOV_COLOUR_TOKENS)
const MOISTURES = new Set(DOV_MOISTURE_TOKENS.map(m => m.token))
const CONSISTENCIES = new Set(DOV_CONSISTENCY_TOKENS.map(c => c.token))

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** The code a soil name stands for, with the approximation when it is one. */
function soilCode(name: string): { code: string; approximation?: SoilApproximation } | null {
  const exact = SOIL_BY_NAME.get(name)
  if (exact !== undefined) return { code: exact }
  const near = DESCRIPTION_SOIL_APPROXIMATIONS[name]
  if (near !== undefined) return { code: near, approximation: { phrase: name, code: near } }
  return null
}

/** Split a leading amount phrase off: ``"sterk silt"`` -> ``["V", "silt"]``. */
function splitAmount(phrase: string): [string, string] {
  for (const [words, code] of DESCRIPTION_AMOUNT_WORDS) {
    if (phrase.startsWith(`${words} `)) return [code, phrase.slice(words.length + 1)]
  }
  return [DESCRIPTION_DEFAULT_AMOUNT, phrase]
}

/** Cut parenthesised notes out of a clause: ``["steenfragmenten", ["(tot 20mm)"]]``. */
function cutNotes(clause: string): [string, string[]] {
  const notes: string[] = []
  let rest = ''
  let depth = 0
  let note = ''
  for (const ch of clause) {
    if (ch === '(') depth += 1
    if (depth > 0) note += ch
    else rest += ch
    if (ch === ')' && depth > 0) {
      depth -= 1
      if (depth === 0) {
        notes.push(note.trim())
        note = ''
      }
    }
  }
  if (note !== '') rest += note // an unclosed "(" stays part of the clause
  return [normalise(rest), notes]
}

/**
 * Read one DOV lithological description into a coded draft.
 *
 * @param description - The description verbatim (any case / spacing).
 * @returns The draft; ``unmatched`` lists everything that produced no code.
 */
export function parseDescribedLithology(description: string): DescribedLithologyDraft {
  const draft: DescribedLithologyDraft = {
    source: description,
    mainSoil: [],
    admixtures: [],
    color: '',
    moisture: '',
    consistency: '',
    unmatched: [],
    approximations: [],
  }
  const note = (approximation: SoilApproximation | undefined) => {
    if (approximation && !draft.approximations.some(a => a.phrase === approximation.phrase)) {
      draft.approximations.push(approximation)
    }
  }

  const clauses = description.split(',')
  clauses.forEach((raw, index) => {
    const [clause, notes] = cutNotes(raw)
    if (clause !== '') {
      const matched = index === 0 ? readMainSoil(clause, draft, note) : readClause(clause, draft, note)
      if (!matched) draft.unmatched.push(clause)
    }
    draft.unmatched.push(...notes)
  })
  return draft
}

type Note = (approximation: SoilApproximation | undefined) => void

/** The first clause: a soil, or a grade range of one soil. */
function readMainSoil(clause: string, draft: DescribedLithologyDraft, note: Note): boolean {
  const range = clause.indexOf(DESCRIPTION_RANGE_WORD)
  const names: string[] = []
  if (range < 0) {
    names.push(clause)
  } else {
    // "zeer fijn tot fijn zand": the soil noun is the last word of the second
    // half and belongs to both grades.
    const second = clause.slice(range + DESCRIPTION_RANGE_WORD.length)
    const noun = second.slice(second.lastIndexOf(' ') + 1)
    names.push(`${clause.slice(0, range)} ${noun}`, second)
  }
  const hits = names.map(soilCode)
  if (hits.some(h => h === null)) return false
  for (const hit of hits) {
    if (hit === null) continue
    note(hit.approximation)
    if (!draft.mainSoil.includes(hit.code)) draft.mainSoil.push(hit.code)
  }
  return true
}

/** Any later clause; ``false`` when it yields nothing (it is then unmatched). */
function readClause(clause: string, draft: DescribedLithologyDraft, note: Note): boolean {
  if (COLOURS.has(clause)) return fillOnce(draft, 'color', clause)
  if (MOISTURES.has(clause)) return fillOnce(draft, 'moisture', clause)
  if (CONSISTENCIES.has(clause)) return fillOnce(draft, 'consistency', clause)
  return readAdmixture(clause, draft, note)
}

function fillOnce(draft: DescribedLithologyDraft, field: 'color' | 'moisture' | 'consistency', token: string): boolean {
  if (draft[field] !== '') return false
  draft[field] = token
  return true
}

/** "[amount] <soil>houdend" or "[amount] <soil>". */
function readAdmixture(clause: string, draft: DescribedLithologyDraft, note: Note): boolean {
  const adjective = clause.endsWith(DESCRIPTION_ADMIXTURE_SUFFIX)
  const phrase = adjective ? clause.slice(0, -DESCRIPTION_ADMIXTURE_SUFFIX.length) : clause
  // "matig fijn zandhoudend" may be a grade ("moderately fine"), not amount M.
  if (DESCRIPTION_GRADE_WORDS.some(g => phrase.startsWith(`matig ${g}`))) return false
  const [amount, name] = splitAmount(phrase)
  const hit = soilCode(name)
  if (hit === null) return false
  if (draft.admixtures.length >= MAX_ADMIXTURES_PER_INTERVAL) return false
  if (draft.admixtures.some(a => a.soil_code === hit.code)) return false
  note(hit.approximation)
  draft.admixtures.push({ soil_code: hit.code, amount, locally: false })
  return true
}
