// DOV closed vocabularies for the borehole track editor (owner 2026-09-29:
// "with the dov codelist ofc"). The editor offers ONLY these values for the
// kinds DOV defines a closed list for; the stored value is always the raw DOV
// token (translate at the presentation boundary, never at ingest).
//
// Where each list comes from:
//
// * Soil codes (main soil + admixture soil) — NOT here: they are the 127 keys of
//   `SOIL_COLORS` in `soilColors.ts`, itself transcribed from
//   `src/groundmodel/infrastructure/codelists/data/codetabel_hoofdnaam.csv`
//   (checked: the key set equals the CSV code column exactly).
// * Admixture amount — `ADMIXTURE_AMOUNT_OPTIONS` in `lithoLabels.ts` (the
//   DOV Z/W/M/V/S steps plus the N / WM / MV tokens found in real DOV data).
// * Colour — `DOV_COLOUR_TOKENS` below, every "Beschrijving" of
//   `codetabel_kleur.csv` (294 tokens). DOV ships the Dutch word, not the
//   numeric code, in both `<kleur>` elements, so the word IS the stored token.
// * Moisture / consistency — `BoringVochtgehalteEnumType` /
//   `BoringConsistentieEnumType` of DOV's `BoringDataCodes.xsd`
//   (https://www.dov.vlaanderen.be/xdov/schema/latest/xsd/kern/boring/BoringDataCodes.xsd,
//   fetched 2026-09-29; snapshot in `codelists/data/BoringDataCodes.xsd`). The
//   XSD's consistency list has one more value than `codetabel_consistentie.csv`
//   ("korrelig"); the XSD is what DOV validates against, so it wins.
// * Formal stratigraphy — the backend's DOV formal-stratigraphy catalog
//   (`GET /codelists/formal-stratigraphy`, 403 codes), loaded at run time.

/** Every DOV colour token (`codetabel_kleur.csv`, "Beschrijving"), sorted. */
export const DOV_COLOUR_TOKENS: readonly string[] = [
  'beige', 'beigeblauw', 'beigebruin', 'beigegeel', 'beigegrijs', 'beigegroen', 'beigekaki',
  'beigemauve', 'beigeoker', 'beigeolijfgroen', 'beigeoranje', 'beigeroest', 'beigerood',
  'beigeroos', 'beigewit', 'beigezwart', 'blauw', 'blauwbeige', 'blauwbruin', 'blauwgeel',
  'blauwgrijs', 'blauwgroen', 'blauwkaki', 'blauwmauve', 'blauwoker', 'blauwolijfgroen',
  'blauworanje', 'blauwroest', 'blauwrood', 'blauwroos', 'blauwwit', 'blauwzwart',
  'bleek / ontkleurd', 'bontgekleurd', 'bruin', 'bruinbeige', 'bruinblauw', 'bruingeel',
  'bruingrijs', 'bruingroen', 'bruinkaki', 'bruinmauve', 'bruinoker', 'bruinolijfgroen',
  'bruinoranje', 'bruinroest', 'bruinrood', 'bruinroos', 'bruinwit', 'bruinzwart', 'donkerbeige',
  'donkerblauw', 'donkerbruin', 'donkergeel', 'donkergrijs', 'donkergroen', 'donkerkaki',
  'donkermauve', 'donkeroker', 'donkerolijfgroen', 'donkeroranje', 'donkerroest', 'donkerrood',
  'donkerroos', 'donkerwit', 'donkerzwart', 'geel', 'geelbeige', 'geelblauw', 'geelbruin',
  'geelgrijs', 'geelgroen', 'geelkaki', 'geelmauve', 'geeloker', 'geelolijfgroen', 'geeloranje',
  'geelroest', 'geelrood', 'geelroos', 'geelwit', 'geelzwart', 'grijs', 'grijsbeige',
  'grijsblauw', 'grijsbruin', 'grijsgeel', 'grijsgroen', 'grijskaki', 'grijsmauve', 'grijsoker',
  'grijsolijfgroen', 'grijsoranje', 'grijsroest', 'grijsrood', 'grijsroos', 'grijswit',
  'grijszwart', 'groen', 'groenbeige', 'groenblauw', 'groenbruin', 'groengeel', 'groengrijs',
  'groenkaki', 'groenmauve', 'groenoker', 'groenolijfgroen', 'groenoranje', 'groenroest',
  'groenrood', 'groenroos', 'groenwit', 'groenzwart', 'kaki', 'kakibeige', 'kakiblauw',
  'kakibruin', 'kakigeel', 'kakigrijs', 'kakigroen', 'kakimauve', 'kakioker', 'kakiolijfgroen',
  'kakioranje', 'kakiroest', 'kakirood', 'kakiroos', 'kakiwit', 'kakizwart', 'lichtbeige',
  'lichtblauw', 'lichtbruin', 'lichtgeel', 'lichtgrijs', 'lichtgroen', 'lichtkaki', 'lichtmauve',
  'lichtoker', 'lichtolijfgroen', 'lichtoranje', 'lichtroest', 'lichtrood', 'lichtrood / roos',
  'lichtroos', 'lichtwit', 'lichtzwart', 'mauve', 'mauvebeige', 'mauveblauw', 'mauvebruin',
  'mauvegeel', 'mauvegrijs', 'mauvegroen', 'mauvekaki', 'mauveoker', 'mauveolijfgroen',
  'mauveoranje', 'mauveroest', 'mauverood', 'mauveroos', 'mauvewit', 'mauvezwart', 'oker',
  'okerbeige', 'okerblauw', 'okerbruin', 'okergeel', 'okergrijs', 'okergroen', 'okerkaki',
  'okermauve', 'okerolijfgroen', 'okeroranje', 'okerroest', 'okerrood', 'okerroos', 'okerwit',
  'okerzwart', 'olijfgroen', 'olijfgroenbeige', 'olijfgroenblauw', 'olijfgroenbruin',
  'olijfgroengeel', 'olijfgroengrijs', 'olijfgroengroen', 'olijfgroenkaki', 'olijfgroenmauve',
  'olijfgroenoker', 'olijfgroenoranje', 'olijfgroenroest', 'olijfgroenrood', 'olijfgroenroos',
  'olijfgroenwit', 'olijfgroenzwart', 'onbekend', 'onbepaald', 'oranje', 'oranjebeige',
  'oranjeblauw', 'oranjebruin', 'oranjegeel', 'oranjegrijs', 'oranjegroen', 'oranjekaki',
  'oranjemauve', 'oranjeoker', 'oranjeolijfgroen', 'oranjeoranje', 'oranjeroest', 'oranjerood',
  'oranjeroos', 'oranjewit', 'paarsbruin', 'roest', 'roestbeige', 'roestblauw', 'roestbruin',
  'roestgeel', 'roestgrijs', 'roestgroen', 'roestkaki', 'roestmauve', 'roestoker',
  'roestolijfgroen', 'roestoranje', 'roestroest', 'roestrood', 'roestroos', 'roestwit',
  'roestzwart', 'rood', 'roodbeige', 'roodblauw', 'roodbruin', 'roodgeel', 'roodgrijs',
  'roodgroen', 'roodkaki', 'roodmauve', 'roodoker', 'roodolijfgroen', 'roodoranje', 'roodroest',
  'roodroos', 'roodwit', 'roodzwart', 'roos', 'roosbeige', 'roosblauw', 'roosbruin', 'roosgeel',
  'roosgrijs', 'roosgroen', 'rooskaki', 'roosmauve', 'roosoker', 'roosolijfgroen', 'roosoranje',
  'roosroest', 'roosrood', 'rooswit', 'rooszwart', 'wit', 'witbeige', 'witblauw', 'witbruin',
  'witgeel', 'witgrijs', 'witgroen', 'witkaki', 'witmauve', 'witoker', 'witolijfgroen',
  'witoranje', 'witroest', 'witrood', 'witroos', 'zwart', 'zwartbeige', 'zwartblauw',
  'zwartbruin', 'zwartgeel', 'zwartgrijs', 'zwartgroen', 'zwartkaki', 'zwartmauve', 'zwartoker',
  'zwartolijfgroen', 'zwartoranje', 'zwartroest', 'zwartrood', 'zwartroos', 'zwartwit',
]

/** DOV moisture tokens (`BoringVochtgehalteEnumType`), dry to wet, with English. */
export const DOV_MOISTURE_TOKENS: ReadonlyArray<{ token: string; en: string }> = [
  { token: 'droog', en: 'dry' },
  { token: 'weinig vochtig', en: 'slightly moist' },
  { token: 'vochtig', en: 'moist' },
  { token: 'zeer vochtig', en: 'very moist' },
  { token: 'verzadigd', en: 'saturated' },
]

/** DOV consistency tokens (`BoringConsistentieEnumType`), soft to hard, with English. */
export const DOV_CONSISTENCY_TOKENS: ReadonlyArray<{ token: string; en: string }> = [
  { token: 'zeer slap', en: 'very soft' },
  { token: 'slap', en: 'soft' },
  { token: 'plastisch', en: 'plastic' },
  { token: 'matig vast', en: 'moderately firm' },
  { token: 'vast', en: 'firm' },
  { token: 'hard', en: 'hard' },
  { token: 'versteend', en: 'lithified' },
  { token: 'korrelig', en: 'granular' },
]

/** Whole-token English for the colour words that are not a compound. */
export const DOV_COLOUR_SPECIAL_EN: Readonly<Record<string, string>> = {
  'bleek / ontkleurd': 'pale / bleached',
  bontgekleurd: 'variegated',
  onbekend: 'unknown',
  onbepaald: 'undetermined',
  'lichtrood / roos': 'light red / pink',
}

/**
 * English for the colour word parts a DOV compound is built from
 * ("groenbruin" = groen + bruin). Longest first, so "olijfgroen" is matched
 * before "groen".
 */
export const DOV_COLOUR_WORDS_EN: ReadonlyArray<readonly [string, string]> = [
  ['olijfgroen', 'olive green'],
  ['donker', 'dark'],
  ['licht', 'light'],
  ['oranje', 'orange'],
  ['beige', 'beige'],
  ['blauw', 'blue'],
  ['bruin', 'brown'],
  ['grijs', 'grey'],
  ['groen', 'green'],
  ['mauve', 'mauve'],
  ['paars', 'purple'],
  ['roest', 'rust'],
  ['zwart', 'black'],
  ['geel', 'yellow'],
  ['kaki', 'khaki'],
  ['oker', 'ochre'],
  ['rood', 'red'],
  ['roos', 'pink'],
  ['wit', 'white'],
]

/** Depth grain of a track interval: 1 mm, mirroring the backend's
 *  `LITHO_LAYER_DEPTH_DECIMALS` (`shared/constants/db_constraints.py`). */
export const TRACK_DEPTH_DECIMALS = 3

/** Admixtures per interval of a coded track (coded lithology / geotechnical
 *  coding). Mirrors the backend's `MAX_ADMIXTURES_PER_INTERVAL`
 *  (`domain/services/borehole_track_constants.py`). Why 3: DOV's own practice
 *  (no coded layer in the local DOV cache carries more than 3) and the owner's
 *  ruling 2026-09-30, "i want max 3 admixtures in coded lithology". The editor
 *  never offers a fourth row. */
export const MAX_ADMIXTURES_PER_INTERVAL = 3
