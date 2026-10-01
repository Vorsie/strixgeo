// Word tables for reading a Dutch DOV lithological description into DOV codes
// (owner 2026-10-01: "parse the description into codes"). Used ONLY by
// `describedLithologyToCodes.ts`. Every code below is a key of `SOIL_COLORS`
// (= `codetabel_hoofdnaam.csv`) or a token of `ADMIXTURE_AMOUNT_OPTIONS`; no
// code is invented here.
//
// Calibration: the local DOV cache (~/.groundmodel/dov_cache/interpretatie,
// 1367 interpretations, 2026-10-01) holds 1837 layers where the SAME boring
// carries a lithological description AND a coded lithology / geotechnical
// coding over the same depth interval. Tallying the words in front of
// "<soil>houdend" against the coded <hoeveelheid> of layers with exactly one
// such clause and one admixture gave: bare -> N 60 of 114; "weinig" -> W 7/9;
// "licht" -> W 6/8; "sterk" -> V 13/24 (S 3); "zeer sterk" -> S; "zeer licht"
// -> Z. The table below follows those majorities.

/**
 * The DOV amount (`<bijmenging><hoeveelheid>`) a qualifier word names, longest
 * phrase first so "zeer sterk" is read before "sterk". A word not in this table
 * is NOT guessed: its clause stays unmatched.
 */
export const DESCRIPTION_AMOUNT_WORDS: ReadonlyArray<readonly [string, string]> = [
  // The owner's five DOV steps (brief 2026-10-01): sporadisch / weinig /
  // matig / sterk / zeer sterk = Z / W / M / V / S.
  ['zeer sterk', 'S'],
  // "veel" is the noun-phrase word for the same step as "sterk" ("veel
  // plantenresten" is coded V in the cache); "zeer veel" one step up.
  ['zeer veel', 'S'],
  // "zeer licht" / "zeer weinig": below "weinig", the lowest step (cache: Z).
  ['zeer licht', 'Z'],
  ['zeer weinig', 'Z'],
  ['sporadisch', 'Z'],
  ['sterk', 'V'],
  ['veel', 'V'],
  ['matig', 'M'],
  ['weinig', 'W'],
  // "licht" is the -houdend twin of "weinig" in DOV's descriptions (cache: W).
  ['licht', 'W'],
]

/**
 * The amount of an admixture whose clause carries no qualifier ("kalkhoudend",
 * "steenfragmenten"): DOV's N ("met", present, amount not stated), the token
 * DOV's own coders use for a bare "-houdend" in the cache (60 of 114).
 */
export const DESCRIPTION_DEFAULT_AMOUNT = 'N'

/** The suffix of an admixture adjective ("silthoudend" = silt + houdend). */
export const DESCRIPTION_ADMIXTURE_SUFFIX = 'houdend'

/** The word that joins two grades of one soil ("zeer fijn tot fijn zand"). */
export const DESCRIPTION_RANGE_WORD = ' tot '

/**
 * Soil names DOV's descriptions use that have NO own code in
 * `codetabel_hoofdnaam.csv`, mapped to the nearest code. Each is reported back
 * as an approximation so the person checking sees it.
 */
export const DESCRIPTION_SOIL_APPROXIMATIONS: Readonly<Record<string, string>> = {
  // The hoofdnaam list stops at FZ ("fijn zand"); DOV's own coders code "zeer
  // fijn zand" as FZ (cache: "silt, sterk zeer fijn zandhoudend" -> SI + FZ).
  'zeer fijn zand': 'FZ',
}

/**
 * Words that turn "matig" into a GRADE ("matig fijn zand" = moderately fine
 * sand), not an amount. A "-houdend" clause starting "matig <one of these>" is
 * ambiguous and stays unmatched instead of being read as amount M.
 */
export const DESCRIPTION_GRADE_WORDS: readonly string[] = ['fijn', 'grof']
