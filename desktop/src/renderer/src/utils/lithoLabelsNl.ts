// Dutch (Flemish) admixture display vocabulary for lithostratigraphic units.
//
// Split out of ``lithoLabels.ts`` (500-line ceiling, debt #201) AND to keep the
// NL vocabulary in one reviewable place: the base soil word is the domain's own
// source token (``LITHOLOGY_LABELS_NL``), but the admixture adjectives + amount
// scale words below are a presentation-boundary CHOICE, not a lookup.
//
// FLAG (owner): confirm each of these against your borehole-log vernacular. The
// admixture scale (DOV amount codes Z/W/M/V/S) is rendered on the NEN
// zwak/matig/sterk axis here as a best attempt; the admixture soil adjectives
// follow the same field register. Only the CORE codes a BE/NL log carries are
// curated — an uncurated code falls back to the English adjective in
// ``lithoLabels.ts`` so a rare rock-type bijmenging still renders.

/** Admixture soil code → Dutch adjective ("kleiig") or "met X" noun phrase. */
export const ADMIXTURE_SOIL_NL: Record<string, string> = {
  // Core five soils.
  GL: 'grindig',
  KL: 'kleiig',
  SL: 'siltig',
  ZN: 'zandig',
  VE: 'venig',
  // Aliases / DOV variants.
  Z: 'zandig',
  K: 'kleiig',
  S: 'siltig',
  G: 'grindig',
  V: 'venig',
  XZ: 'zandig',
  XG: 'grindig',
  FZ: 'fijnzandig',
  MZ: 'matigzandig',
  GZ: 'grofzandig',
  FG: 'fijngrindig',
  MG: 'matiggrindig',
  GG: 'grofgrindig',
  LE: 'lemig',
  ZL: 'zandlemig',
  // Organic admixtures.
  OM: 'organisch',
  HU: 'humeus',
  HT: 'met houtresten',
  HC: 'met houtskool',
  PL: 'met plantenresten',
  PC: 'met poederkool',
  AG: 'met as',
  LG: 'met ligniet',
  CO: 'met steenkool',
  // Carbonate / shell admixtures.
  KA: 'kalkhoudend',
  SC: 'met schelpen',
  SF: 'met schelpfragmenten',
  SG: 'met schelpgruis',
  NN: 'met nummulieten',
  FO: 'met fossielen',
}

/**
 * Amount adverb for ADJECTIVE admixtures ("matig kleiig").
 *
 * FLAG (owner): verify the Flemish scale word per DOV code — the norm axis is
 * zwak / matig / sterk, but the DOV codes are a five-step Z/W/M/V/S.
 */
export const ADMIXTURE_AMOUNT_NL: Record<string, string> = {
  Z: 'zwak',
  W: 'weinig',
  M: 'matig',
  V: 'veel',
  S: 'sterk',
  N: 'met', // intensity-unspecified marker
  WM: 'weinig tot matig',
  MV: 'matig tot veel',
}

/** Quantity word for NOUN-PHRASE admixtures ("weinig schelpgruis"). FLAG as above. */
export const ADMIXTURE_AMOUNT_QUANTITY_NL: Record<string, string> = {
  Z: 'sporen',
  W: 'weinig',
  M: 'enkele',
  V: 'veel',
  S: 'veel',
  N: '',
  WM: 'weinig tot enkele',
  MV: 'enkele tot veel',
}
