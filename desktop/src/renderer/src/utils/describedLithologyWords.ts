/**
 * The word tables of ``describedLithologyToCodes`` turned into lookups: one
 * word (accent-free) -> what it is (soil noun, admixture noun or adjective,
 * colour, grade ...), plus the tokenizer that expands "X- en Y<ending>". Pure.
 * Split out of ``describedLithologyToCodes.ts`` (file-size budget, debt #201).
 */

import {
  ADJECTIVE_SUFFIXES,
  ADMIXTURE_NOUNS,
  AMOUNT_PHRASES,
  COLOUR_PREFIXES,
  COLOUR_STEMS,
  CONSISTENCY_FORMS,
  DENIALS,
  DENYING_SUFFIXES,
  FILLER_WORDS,
  FRENCH_ADJECTIVES,
  FRENCH_COLOURS,
  GRADE_PHRASES,
  GRADED_SAND,
  LOCALLY_WORDS,
  MAIN_SOIL_NOUNS,
  MODIFIER_WORDS,
  MOISTURE_FORMS,
  NOTE_WORDS,
  NOUN_PHRASES,
  NOUN_SUFFIXES,
  RICH_SUFFIXES,
  SAME_AS_ABOVE,
  SHELL_ENDING_CODES,
  SOFT_SEPARATORS,
  STEM_CODES,
  WITH_WORDS,
  type GradedSoil,
} from './describedLithologyToCodes_constants'
import { DOV_COLOUR_TOKENS } from './dovTrackCodelists_constants'

/** A soil name mapped to the nearest DOV code because it has none of its own. */
export interface SoilApproximation {
  phrase: string
  code: string
}

export type GradeLetter = 'F' | 'M' | 'G'
export type Grade = { grade: GradeLetter; exact: boolean; text: string }
export type Token = { kind: 'word' | 'sep' | 'note'; w: string }
export type Adjective = { target: string | GradedSoil; intrinsic?: GradeLetter; rich: boolean; denies: boolean }

export const COLOURS = new Set(DOV_COLOUR_TOKENS)
export const FILLERS = new Set(FILLER_WORDS)
export const MODIFIERS = new Set(MODIFIER_WORDS)
export const NOTE_SET = new Set(NOTE_WORDS)
export const FRENCH_COLOUR_SET = new Set(FRENCH_COLOURS)
export const LOCALLY = new Set(LOCALLY_WORDS)
export const SOFT = new Set(SOFT_SEPARATORS)
export const WITH = new Set(WITH_WORDS)
const STEMS = Object.keys(STEM_CODES)
/** Stems an "X- en Y<ending>" pair is split on: soil stems and colour stems. */
const SPLIT_STEMS = [...new Set([...STEMS, ...COLOUR_STEMS, ...COLOUR_PREFIXES])].sort((a, b) => b.length - a.length)
/** Adjective stems with a grade of their own ("fijnzandig" = fine sand). */
const INTRINSIC_GRADE: Readonly<Record<string, GradeLetter>> = { fijnzand: 'F', middelzand: 'M', grofzand: 'G' }
const DENIAL_TABLE: Readonly<Record<string, true>> = Object.fromEntries(DENIALS.map(d => [d, true]))
/** Every multi-word phrase table, for the longest-first lookup. */
export const PHRASE_TABLES: ReadonlyArray<Readonly<Record<string, unknown>>> = [
  NOUN_PHRASES,
  CONSISTENCY_FORMS,
  MOISTURE_FORMS,
  GRADE_PHRASES,
  AMOUNT_PHRASES,
  DENIAL_TABLE,
]
export const MAX_PHRASE_WORDS = 3
const VOWEL_DOUBLING = /^(.*[^aeiou])([aeiou])([^aeiou])$/

/** Lower case with the accents off (dov-desktopstudie ``_plain``). */
export function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/�/g, '')
    .toLowerCase()
}

/** The DOV colour token a (possibly inflected) word names, or ``null``. */
export function dovColour(word: string): string | null {
  const candidates = [word]
  if (word.endsWith('ze')) candidates.push(`${word.slice(0, -2)}s`) // grijze -> grijs
  if (word.endsWith('tte')) candidates.push(word.slice(0, -2)) // witte -> wit
  if (word.endsWith('e')) {
    const base = word.slice(0, -1)
    candidates.push(base) // bruine -> bruin
    // rode -> rood, gele -> geel: the vowel doubles once the ending is gone.
    const m = base.match(VOWEL_DOUBLING)
    if (m) candidates.push(`${m[1]}${m[2]}${m[2]}${m[3]}`)
  }
  return candidates.find(c => COLOURS.has(c)) ?? null
}

/** A colour word DOV's list does not carry (bleekgrijs, roestkleurig). */
export function colourLike(word: string): boolean {
  if (/houdend|rijk/.test(word) || STEMS.some(s => word.startsWith(s))) return false
  return COLOUR_STEMS.some(stem => word.includes(stem))
}

/** The uninflected form of an adjective for a note ("fijnzandige" -> "fijnzandig"). */
export function lemma(word: string): string {
  return /(ig|isch|nd|ijk|eus)e$/.test(word) ? word.slice(0, -1) : word
}

/** Split a word into a known stem and the rest: "blauwgrijze" -> ["blauw", "grijze"]. */
function splitStem(word: string): [string, string] | null {
  const stem = SPLIT_STEMS.find(s => word.length > s.length && word.startsWith(s))
  return stem === undefined ? null : [stem, word.slice(stem.length)]
}

/** Tokens: words, separators, parenthesised notes; digits carry no code. */
export function tokenize(text: string): Token[] {
  const out: Token[] = []
  const re = /\([^)]*\)?|\[[^\]]*\]?|[a-z]+(?:-[a-z]+)*-?|[,;:./]|\d[\d.,%/-]*|\S/g
  for (const m of text.matchAll(re)) {
    const t = m[0]
    if (t.startsWith('(') || t.startsWith('[')) out.push({ kind: 'note', w: t.trim() })
    else if (/^[,;:./]$/.test(t)) out.push({ kind: 'sep', w: t })
    else if (/^[a-z]/.test(t)) out.push({ kind: 'word', w: t })
  }
  return expandHyphens(out)
}

/**
 * "leem- en glauconiethoudend" -> "leemhoudend en glauconiethoudend";
 * "bruin- en blauwgrijze" -> "bruingrijze en blauwgrijze"; "grijs-bruin" ->
 * "grijsbruin" (a DOV colour); any other inner hyphen -> two words.
 */
function expandHyphens(tokens: Token[]): Token[] {
  const out: Token[] = []
  tokens.forEach((tok, i) => {
    if (tok.kind !== 'word') {
      out.push(tok)
      return
    }
    if (tok.w.endsWith('-')) {
      out.push({ kind: 'word', w: tok.w.slice(0, -1) + sharedEnding(tokens, i) })
      return
    }
    if (tok.w.includes('-')) {
      const joined = tok.w.replace(/-/g, '')
      if (dovColour(joined) !== null) out.push({ kind: 'word', w: joined })
      else for (const part of tok.w.split('-')) if (part !== '') out.push({ kind: 'word', w: part })
      return
    }
    out.push(tok)
  })
  return out
}

/** The ending the word after "en" / "of" shares with an "X-" at ``i``. */
function sharedEnding(tokens: Token[], i: number): string {
  let j = i + 1
  while (j < tokens.length && tokens[j].kind === 'sep' && tokens[j].w === ',') j++
  if (j >= tokens.length || tokens[j].kind !== 'word' || !SOFT.has(tokens[j].w)) return ''
  for (let k = j + 1; k < Math.min(tokens.length, j + 5); k++) {
    if (tokens[k].kind !== 'word') break
    const split = splitStem(tokens[k].w.replace(/-$/, ''))
    if (split !== null) return split[1]
  }
  return ''
}

/** The code a stem or noun names, graded by the first pending grade. */
export function gradedCode(
  target: string | GradedSoil,
  grades: readonly Grade[],
  intrinsic?: GradeLetter,
): { code: string; approximation?: SoilApproximation } {
  if (typeof target === 'string') return { code: target }
  const g = grades[0]
  const code = target[g?.grade ?? intrinsic ?? 'X']
  return g !== undefined && !g.exact ? { code, approximation: { phrase: `${g.text} ${target.name}`, code } } : { code }
}

/** An admixture noun: a whole word, or a stem + noun ending (veen+resten). */
export function admixtureNoun(word: string): string | null {
  const exact = ADMIXTURE_NOUNS[word]
  if (exact !== undefined) return exact
  for (const suffix of NOUN_SUFFIXES) {
    if (!word.endsWith(suffix) || word.length <= suffix.length) continue
    const stem = word.slice(0, -suffix.length)
    const target = STEM_CODES[stem]
    if (target === undefined) continue
    if (stem === 'schelp' || stem === 'schelpen') {
      return SHELL_ENDING_CODES.find(([re]) => re.test(suffix))?.[1] ?? 'SC'
    }
    return typeof target === 'string' ? target : target.X
  }
  return null
}

/** An admixture adjective (stem + houdend / rijk / ig ...), or a denying one. */
export function admixtureAdjective(word: string): Adjective | null {
  const french = FRENCH_ADJECTIVES[word]
  if (french !== undefined) return { target: french, rich: false, denies: false }
  const tables: ReadonlyArray<readonly [readonly string[], boolean]> = [
    [DENYING_SUFFIXES, true],
    [ADJECTIVE_SUFFIXES, false],
  ]
  for (const [suffixes, denies] of tables) {
    for (const suffix of suffixes) {
      if (!word.endsWith(suffix) || word.length <= suffix.length) continue
      const stem = word.slice(0, -suffix.length)
      const target = STEM_CODES[stem]
      if (target === undefined) continue
      const intrinsic = INTRINSIC_GRADE[stem]
      return {
        target: intrinsic !== undefined ? GRADED_SAND : target,
        intrinsic,
        rich: RICH_SUFFIXES.includes(suffix),
        denies,
      }
    }
  }
  return null
}

/** The "same as above" opening of a description, and the token after it. */
export function sameAsAbove(tokens: Token[]): { phrase: string; next: number } | null {
  const first = tokens.findIndex(t => t.kind === 'word')
  if (first < 0) return null
  for (const phrase of SAME_AS_ABOVE) {
    const words = phrase.split(' ')
    const slice = tokens.slice(first, first + words.length)
    if (slice.length === words.length && slice.every((t, k) => t.kind === 'word' && t.w === words[k])) {
      return { phrase, next: first + words.length }
    }
  }
  return null
}

/**
 * Two plain stems glued: "kalkzand", "leemzand" = the last one is the soil
 * (dov-desktopstudie ``_is_compound_ordinary``); the first is not coded.
 */
export function compoundMainNoun(word: string): string | GradedSoil | null {
  for (const [noun, target] of Object.entries(MAIN_SOIL_NOUNS)) {
    if (word.length > noun.length && word.endsWith(noun) && word.slice(0, -noun.length) in STEM_CODES) return target
  }
  return null
}

