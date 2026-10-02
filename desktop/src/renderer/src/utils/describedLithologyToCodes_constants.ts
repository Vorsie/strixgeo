// Word tables for reading a DOV lithological description into DOV codes
// (owner 2026-10-01: "parse the description into codes"; rewritten 2026-10-02
// after a real contractor-style borehole read 0 of 17 layers). Used ONLY by
// `describedLithologyToCodes.ts`. Every code below is a key of `SOIL_COLORS`
// (= `codetabel_hoofdnaam.csv`) or a token of `ADMIXTURE_AMOUNT_OPTIONS`; no
// code is invented here.
//
// Approach and word stock ported from the owner's own description classifier
// (dov-desktopstudie, `desktopstudie/core/lithology.py`, vocabulary counted on
// 3 630 DOV layer descriptions by `scripts/lithology_vocabulary.py`): the
// accent-free comparison (`_plain`), the "plain stem + modifier suffix" rule
// (ORDINARY_STEMS x MODIFIER_SUFFIXES: kleibrokjes, veenresten, fijnzandhoudend),
// the colour stems, the denials (geen / zonder / -loos / -vrij / -arm) and the
// French of the pre-war records. That module only decides what is ordinary;
// here the same stems are mapped to DOV codes. No runtime dependency on it.
//
// Calibration (2026-10-02): the local DOV cache (~/.groundmodel/dov_cache/
// interpretatie, 1 367 interpretations) holds 5 813 described layers, 1 932 of
// them with a coded lithology / geotechnical coding of the SAME boring over the
// same interval (>= 80 % overlap). Word -> admixture code co-occurrence on those
// rows chose the noun codes below (e.g. "kleilenzen" -> KL 28/28,
// "zandsteenbrokken" -> ZS 65/67, "schelpgruis" -> SG 141/160, "plantenresten"
// -> PL 30/35, "houtresten" -> HT 14/18, "steenfragmenten" -> SN 15/29); the
// amount steps follow the 2026-10-01 tally (bare "-houdend" -> N 60/114,
// "weinig"/"licht" -> W, "sterk" -> V, "zeer sterk" -> S, "zeer licht" -> Z).

/** A soil that DOV grades by grain size (zand, grind) and its four codes. */
export interface GradedSoil {
  /** The DOV name the approximation note quotes ("zand"). */
  name: string
  F: string
  M: string
  G: string
  /** No grade named. */
  X: string
}

export const GRADED_SAND: GradedSoil = { name: 'zand', F: 'FZ', M: 'MZ', G: 'GZ', X: 'XZ' }
export const GRADED_GRAVEL: GradedSoil = { name: 'grind', F: 'FG', M: 'MG', G: 'GG', X: 'XG' }

/**
 * Grade phrases, accent-free. ``exact`` = DOV's own word for the class (fijn /
 * middelmatig / grof); otherwise the NEN / ISO class is mapped to the nearest
 * DOV class and reported as an approximation ("zeer fijn zand" = FZ).
 */
export const GRADE_PHRASES: Readonly<Record<string, { grade: 'F' | 'M' | 'G'; exact: boolean }>> = {
  fijn: { grade: 'F', exact: true },
  fijne: { grade: 'F', exact: true },
  'zeer fijn': { grade: 'F', exact: false },
  'zeer fijne': { grade: 'F', exact: false },
  'heel fijn': { grade: 'F', exact: false },
  'heel fijne': { grade: 'F', exact: false },
  'matig fijn': { grade: 'F', exact: false },
  'tamelijk fijn': { grade: 'F', exact: false },
  'matig fijne': { grade: 'F', exact: false },
  middelmatig: { grade: 'M', exact: true },
  middelmatige: { grade: 'M', exact: true },
  middel: { grade: 'M', exact: true },
  // NEN/ISO "middelgrof 200-630" and "matig grof 210-300" are DOV's medium class.
  middelgrof: { grade: 'M', exact: false },
  middelgrove: { grade: 'M', exact: false },
  'matig grof': { grade: 'M', exact: false },
  'matig grove': { grade: 'M', exact: false },
  grof: { grade: 'G', exact: true },
  grove: { grade: 'G', exact: true },
  'zeer grof': { grade: 'G', exact: false },
  'zeer grove': { grade: 'G', exact: false },
  // French of the older records.
  fin: { grade: 'F', exact: true },
  fins: { grade: 'F', exact: true },
  moyen: { grade: 'M', exact: true },
  moyenne: { grade: 'M', exact: true },
  grossier: { grade: 'G', exact: true },
  grossiere: { grade: 'G', exact: true },
}

/**
 * The DOV amount (`<bijmenging><hoeveelheid>`) a qualifier names, accent-free.
 * Multi-word phrases are matched before single words ("zeer sterk" before
 * "sterk"). DOV's steps: Z sporadisch, W weinig, M matig, V sterk, S zeer
 * sterk; MV = "matig tot sterk". "heel fijn" is a GRADE, never an amount.
 */
export const AMOUNT_PHRASES: Readonly<Record<string, string>> = {
  'zeer sterk': 'S',
  'zeer veel': 'S',
  'heel veel': 'S',
  'zeer rijk aan': 'S',
  'zeer licht': 'Z',
  'zeer weinig': 'Z',
  'zeer zwak': 'Z',
  sporadisch: 'Z',
  sporadische: 'Z',
  'sporen van': 'Z',
  // "redelijk sterk" = fairly strong: between matig and sterk, DOV's MV.
  'redelijk sterk': 'MV',
  'redelijk wat': 'M',
  'redelijk veel': 'M',
  'vrij veel': 'M',
  tamelijk: 'M',
  matig: 'M',
  // A bare "zeer" before an admixture ("zeer kalkhoudend") is the top step.
  zeer: 'S',
  sterk: 'V',
  veel: 'V',
  talrijke: 'V',
  'rijk aan': 'V',
  vol: 'V',
  weinig: 'W',
  licht: 'W',
  lichtjes: 'W',
  zwak: 'W',
  wat: 'W',
  enkele: 'W',
  enigszins: 'W',
  iets: 'W',
  'een beetje': 'W',
  'een paar': 'W',
  // French.
  'un peu': 'W',
  peu: 'W',
  legerement: 'W',
  assez: 'M',
  tres: 'V',
  fortement: 'V',
}

/** The amount of an admixture whose phrase names none ("kalkhoudend"): DOV's N. */
export const DEFAULT_AMOUNT = 'N'
/** The amount a "-rijk" adjective carries without a qualifier ("veenrijke" = V). */
export const RICH_AMOUNT = 'V'

/** A main soil noun (accent-free) -> DOV code, or a graded soil. */
export const MAIN_SOIL_NOUNS: Readonly<Record<string, string | GradedSoil>> = {
  zand: GRADED_SAND,
  zanden: GRADED_SAND,
  kwartszand: GRADED_SAND,
  glauconietzand: GRADED_SAND,
  grind: GRADED_GRAVEL,
  grint: GRADED_GRAVEL,
  klei: 'KL',
  kleien: 'KL',
  silt: 'SI',
  leem: 'LE',
  zandleem: 'ZL',
  veen: 'VE',
  slib: 'SL',
  mergel: 'ME',
  humus: 'HU',
  teelaarde: 'TA',
  teeltaarde: 'TA',
  puin: 'PU',
  keien: 'ST',
  stenen: 'ST',
  krijt: 'KR',
  kalksteen: 'KS',
  zandsteen: 'ZS',
  silex: 'SX',
  silexen: 'SX',
  vuursteen: 'VS',
  ligniet: 'LG',
  afval: 'AF',
  beton: 'BT',
  asfalt: 'AT',
  baksteen: 'BK',
  // French.
  sable: GRADED_SAND,
  sables: GRADED_SAND,
  gravier: GRADED_GRAVEL,
  graviers: GRADED_GRAVEL,
  argile: 'KL',
  argiles: 'KL',
  glaise: 'KL',
  limon: 'LE',
  limons: 'LE',
  tourbe: 'VE',
  cailloux: 'ST',
  craie: 'KR',
  marne: 'ME',
}

/** Multi-word nouns, accent-free. */
export const NOUN_PHRASES: Readonly<Record<string, string>> = {
  'organisch materiaal': 'OM',
  'organische stof': 'OM',
  'terre vegetale': 'TA',
}

/** Admixture-only nouns matched as whole words (never a main soil). */
export const ADMIXTURE_NOUNS: Readonly<Record<string, string>> = {
  glauconiet: 'GL',
  glauconie: 'GL',
  glimmer: 'GI',
  glimmers: 'GI',
  mica: 'GI',
  kalk: 'KA',
  schelp: 'SC',
  schelpen: 'SC',
  schelpjes: 'SC',
  wortels: 'PL',
  worteltjes: 'PL',
  steentjes: 'ST',
  keitjes: 'ST',
  nummulieten: 'NN',
  fossielen: 'FO',
  pyriet: 'PY',
  houtskool: 'HC',
  hout: 'HT',
  kwarts: 'QU',
  coquilles: 'SC',
}

/**
 * Stems that take an admixture-noun ending (veen+resten, klei+lenzen) or an
 * adjective ending (veen+houdend, lem+ig), accent-free -> code or graded soil.
 * Matched longest first, so "zandsteen" wins over "zand" and "baksteen" over
 * "steen".
 */
export const STEM_CODES: Readonly<Record<string, string | GradedSoil>> = {
  zand: GRADED_SAND,
  fijnzand: 'FZ',
  middelzand: 'MZ',
  grofzand: 'GZ',
  grind: GRADED_GRAVEL,
  grint: GRADED_GRAVEL,
  klei: 'KL',
  silt: 'SI',
  leem: 'LE',
  lem: 'LE',
  veen: 'VE',
  ven: 'VE',
  slib: 'SL',
  glauconiet: 'GL',
  glauconit: 'GL',
  glimmer: 'GI',
  mica: 'GI',
  kalk: 'KA',
  humus: 'HU',
  hum: 'HU',
  plant: 'PL',
  planten: 'PL',
  wortel: 'PL',
  hout: 'HT',
  organ: 'OM',
  ligniet: 'LG',
  baksteen: 'BK',
  steen: 'SN',
  zandsteen: 'ZS',
  puin: 'PU',
  kwarts: 'QU',
  pyriet: 'PY',
  silex: 'SX',
  schelp: 'SC',
  schelpen: 'SC',
  nummuliet: 'NN',
  fossiel: 'FO',
}

/** Endings that make a stem an admixture NOUN (dov-desktopstudie MODIFIER_SUFFIXES). */
export const NOUN_SUFFIXES: readonly string[] = [
  'fragmentjes', 'fragmenten', 'fragment', 'restjes', 'resten', 'rest', 'gruis', 'brokjes',
  'brokken', 'brokje', 'lenzen', 'lensjes', 'lens', 'laagjes', 'laagje', 'lagen', 'bolletjes',
  'partikels', 'korrels', 'spikkels', 'vlekken', 'vlekjes', 'stukjes', 'stukken', 'splinters',
  'wortels', 'worteltjes', 'keien', 'insluitsels', 'jes', 'je',
]

/** Shell stems: their ending picks the DOV shell code. */
export const SHELL_ENDING_CODES: ReadonlyArray<readonly [RegExp, string]> = [
  [/gruis$/, 'SG'],
  [/(fragment|rest|brok|stuk)/, 'SF'],
]

/** Endings that make a stem an admixture ADJECTIVE (longest first). */
export const ADJECTIVE_SUFFIXES: readonly string[] = [
  'houdende', 'houdend', 'achtige', 'achtig', 'erige', 'erig', 'rijke', 'rijk', 'ische', 'isch',
  'euze', 'eus', 'ige', 'ig',
]
/** The adjective endings that carry their own amount (RICH_AMOUNT). */
export const RICH_SUFFIXES: readonly string[] = ['rijke', 'rijk']
/** Endings that DENY the stem: "kalkloos", "slibvrij", "glauconietarm". */
export const DENYING_SUFFIXES: readonly string[] = ['loze', 'loos', 'vrije', 'vrij', 'arme', 'arm']

/** French admixture adjectives, accent-free (French inflects, so listed). */
export const FRENCH_ADJECTIVES: Readonly<Record<string, string>> = {
  argileux: 'KL', argileuse: 'KL', argileuses: 'KL', argilo: 'KL',
  sableux: 'XZ', sableuse: 'XZ', sableuses: 'XZ', sablonneux: 'XZ', sablonneuse: 'XZ',
  limoneux: 'LE', limoneuse: 'LE', limoneuses: 'LE',
  graveleux: 'XG', graveleuse: 'XG',
  tourbeux: 'VE', tourbeuse: 'VE',
  glauconifere: 'GL', glauconieux: 'GL', glauconieuse: 'GL',
  calcareux: 'KA', calcareuse: 'KA', calcaire: 'KA',
  micace: 'GI', micacee: 'GI',
  coquillier: 'SC',
}

/** Words that deny what follows: "geen kalk", "niet kalkhoudend", "zonder". */
export const DENIALS: readonly string[] = ['niet', 'geen', 'zonder', 'vrij van', 'sans', 'pas de']

/** Words that set the admixture's "plaatselijk" (locally) flag. */
export const LOCALLY_WORDS: readonly string[] = ['plaatselijk', 'plaatselijke', 'lokaal', 'lokale', 'locaal']

/** DOV consistency tokens in their inflected forms -> token. */
export const CONSISTENCY_FORMS: Readonly<Record<string, string>> = {
  'zeer slap': 'zeer slap', 'zeer slappe': 'zeer slap', slap: 'slap', slappe: 'slap',
  plastisch: 'plastisch', plastische: 'plastisch', 'matig vast': 'matig vast',
  'matig vaste': 'matig vast', vast: 'vast', vaste: 'vast', hard: 'hard', harde: 'hard',
  versteend: 'versteend', versteende: 'versteend', korrelig: 'korrelig', korrelige: 'korrelig',
}
/** DOV moisture tokens in their inflected forms -> token. */
export const MOISTURE_FORMS: Readonly<Record<string, string>> = {
  droog: 'droog', droge: 'droog', 'weinig vochtig': 'weinig vochtig', vochtig: 'vochtig',
  vochtige: 'vochtig', 'zeer vochtig': 'zeer vochtig', verzadigd: 'verzadigd', verzadigde: 'verzadigd',
}
/**
 * Feel / moisture words DOV's lists do not carry: read, reported as a note
 * (never stored), keyed to their uninflected form.
 */
export const FEEL_NOTE_FORMS: Readonly<Record<string, string>> = {
  brokkelig: 'brokkelig', brokkelige: 'brokkelig', vettig: 'vettig', vettige: 'vettig',
  stijf: 'stijf', stijve: 'stijf', taai: 'taai', taaie: 'taai', kleverig: 'kleverig',
  kleverige: 'kleverig', zacht: 'zacht', zachte: 'zacht', los: 'los', losse: 'los',
  compact: 'compact', compacte: 'compact', week: 'week', weke: 'week', kneedbaar: 'kneedbaar',
  vervloeid: 'vervloeid', vervloeiend: 'vervloeiend', vervloeiende: 'vervloeiend',
  nat: 'nat', natte: 'nat',
}

/** Colour stems (dov-desktopstudie COLOUR_STEMS, minus "licht"/"donker"). */
export const COLOUR_STEMS: readonly string[] = [
  'bruin', 'geel', 'gele', 'grijs', 'grijz', 'zwart', 'groen', 'rood', 'rode', 'blauw', 'wit',
  'beige', 'oranje', 'paars', 'roest', 'oker', 'creme', 'kaki', 'bleek', 'mauve', 'roos', 'olijf',
]
/** Prefixes that darken / lighten a colour ("licht grijs" = lichtgrijs). */
export const COLOUR_PREFIXES: readonly string[] = ['licht', 'donker', 'bleek']
/** French colour words: read as a note (DOV's colour list is Dutch). */
export const FRENCH_COLOURS: readonly string[] = [
  'gris', 'grise', 'grises', 'brun', 'brune', 'bruns', 'noir', 'noire', 'noirs', 'blanc', 'blanche',
  'jaune', 'jaunes', 'vert', 'verte', 'verts', 'rouge', 'rouges', 'bleu', 'bleue', 'grisatre',
  'verdatre', 'jaunatre', 'brunatre', 'noiratre', 'roux', 'rousse', 'ocre',
]

/**
 * Descriptive words that qualify the next noun and carry no code: absorbed into
 * the admixture they describe, never reported on their own.
 */
export const MODIFIER_WORDS: readonly string[] = [
  'afgerond', 'afgeronde', 'gerold', 'gerolde', 'hoekig', 'hoekige', 'klein', 'kleine', 'groot',
  'grote', 'dun', 'dunne', 'dik', 'dikke', 'verspreid', 'verspreide', 'gespikkeld', 'gespikkelde',
  'gevlekt', 'gevlekte', 'gemarmerd', 'donker', 'donkere', 'neutraal', 'vezelig', 'vezelige',
  'verweerd', 'verweerde', 'verspoeld', 'verspoelde', 'fijnere', 'grovere', 'brokjes', 'brokken',
  'stukjes', 'resten', 'fonce', 'foncee', 'clair', 'claire', 'egaal',
]

/** Grammatical words: transparent, never reported. */
export const FILLER_WORDS: readonly string[] = [
  'de', 'het', 'een', 'van', 'in', 'op', 'aan', 'bij', 'ook', 'nog', 'die', 'dat', 'is', 'zijn',
  'als', 'om', 'te', 'er', 'eerder', 'overwegend', 'hoofdzakelijk', 'voornamelijk', 'meestal',
  'zelfde', 'dezelfde', 'le', 'la', 'les', 'du', 'des', 'de', 'et', 'un', 'une',
]

/** Words that split the description into phrases (besides punctuation). */
export const SOFT_SEPARATORS: readonly string[] = ['en', 'of', 'maar', 'waaronder', 'alsook', 'ou']
/** "met" opens a phrase whose nouns are admixtures. */
export const WITH_WORDS: readonly string[] = ['met', 'avec']

/** Drilling-method words: read, kept as a note. */
export const NOTE_WORDS: readonly string[] = [
  'pulsboor', 'avegaar', 'edelmanboor', 'steekboor', 'spoelboring', 'pulsboring', 'handboring',
  'sonic', 'drill',
]

/**
 * Openings that say "the layer above" (only usable when the layer above was
 * read): "idem", "zelfde afzetting", "zoals vorige". "zelfde kleur" is NOT one
 * of them: it repeats the colour only.
 */
export const SAME_AS_ABOVE: readonly string[] = ['idem', 'zelfde afzetting', 'zelfde sediment', 'zoals vorige']
