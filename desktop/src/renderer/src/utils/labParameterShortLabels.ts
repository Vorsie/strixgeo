/**
 * Short labels for DOV lab parameters, for the compact sample lines of the
 * track editor's reference pane (owner 2026-10-01: "this is too verbose").
 *
 * Presentation boundary: the API + DB keep the raw DOV parameter token; this
 * table only decides what the compact line prints in front of the value. The
 * raw token stays available as the tooltip. Every label here is a symbol
 * (w, wL, ρ, ρs, CaCO₃, ...) and reads the same in English and Dutch, so none
 * of it goes through the i18n catalogues.
 *
 * Keys are the parameter name WITHOUT DOV's doubled-token tail
 * (``stripDovDoubledTail``), copied from ``dov_constants.py``.
 */

/** What a catch-all parameter is on the compact card. */
export type LabParameterRole =
  /** A measured value printed in the scalar line under ``symbol``. */
  | { kind: 'scalar'; symbol: string; rank: number }
  /** The ASTM classification code (``SW-SM``). */
  | { kind: 'astmCode' }
  /** The ASTM classification description (``Well-graded sand with silt``). */
  | { kind: 'astmName' }
  /** The BGGG soil class (``grofzand``). */
  | { kind: 'bggg' }

/**
 * Print order of the scalar line (owner's brief order: w, CaCO₃, org., ρ, ρs,
 * then Atterberg). A parameter not in the table sorts after all of these, in
 * the order the lab reported it.
 */
export const LAB_SCALAR_RANK = {
  waterContent: 10,
  caco3: 20,
  organicMatter: 30,
  organicCarbon: 35,
  wetDensity: 40,
  grainDensity: 50,
  atterberg: 60,
  clayContentMb: 70,
  unknown: 1000,
} as const

/** Symbols for the typed lab-test families (same symbols as the catch-all). */
export const LAB_SYMBOLS = {
  waterContent: 'w',
  caco3: 'CaCO₃',
  organicMatter: 'org.',
  organicCarbon: 'Corg',
  liquidLimit: 'wL',
  plasticLimit: 'wP',
  plasticityIndex: 'IP',
} as const

/** Catch-all parameter (tail stripped) -> its role on the compact card. */
const LAB_PARAMETER_ROLES: Record<string, LabParameterRole> = {
  Watergehalte: { kind: 'scalar', symbol: LAB_SYMBOLS.waterContent, rank: LAB_SCALAR_RANK.waterContent },
  'Vochtgehalte luchtdroge grond': {
    kind: 'scalar',
    symbol: LAB_SYMBOLS.waterContent,
    rank: LAB_SCALAR_RANK.waterContent,
  },
  // DOV calls it "content of calcareous matter"; the owner reads it as CaCO₃.
  'Gehalte Kalkachtige stoffen': { kind: 'scalar', symbol: LAB_SYMBOLS.caco3, rank: LAB_SCALAR_RANK.caco3 },
  Calciumcarbonaatgehalte: { kind: 'scalar', symbol: LAB_SYMBOLS.caco3, rank: LAB_SCALAR_RANK.caco3 },
  'Gehalte Organische stoffen': {
    kind: 'scalar',
    symbol: LAB_SYMBOLS.organicMatter,
    rank: LAB_SCALAR_RANK.organicMatter,
  },
  'Organische C - percentage': {
    kind: 'scalar',
    symbol: LAB_SYMBOLS.organicCarbon,
    rank: LAB_SCALAR_RANK.organicCarbon,
  },
  'Volumemassa nat': { kind: 'scalar', symbol: 'ρ', rank: LAB_SCALAR_RANK.wetDensity },
  Korrelvolumemassa: { kind: 'scalar', symbol: 'ρs', rank: LAB_SCALAR_RANK.grainDensity },
  // The name itself ends in "(MB)" (methylene-blue method); the tail strip
  // keeps it, so this is the key.
  'Bepaling kleihoudendheid in fractie 0-2 mm (MB)': {
    kind: 'scalar',
    symbol: 'MB',
    rank: LAB_SCALAR_RANK.clayContentMb,
  },
  'Grondsoort volgens ASTM, de code': { kind: 'astmCode' },
  'Grondsoort volgens ASTM, de beschrijving': { kind: 'astmName' },
  'Grondsoort volgens BGGG norm': { kind: 'bggg' },
}

/**
 * The role of a catch-all parameter on the compact card.
 *
 * An unknown parameter becomes a scalar labelled with its DOV name cut to
 * the first clause (before the first comma or parenthesis), ranked last.
 *
 * @param strippedName - The parameter without DOV's doubled tail.
 * @returns The role.
 */
export function labParameterRole(strippedName: string): LabParameterRole {
  const known = LAB_PARAMETER_ROLES[strippedName]
  if (known !== undefined) return known
  const firstClause = strippedName.split(/[,(]/)[0].trim()
  return { kind: 'scalar', symbol: firstClause || strippedName, rank: LAB_SCALAR_RANK.unknown }
}
