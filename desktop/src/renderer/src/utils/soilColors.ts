// Comprehensive lookup table for DOV "hoofdnaam" (main soil-type) codes.
//
// Source: DOV authoritative ``codetabel_hoofdnaam.csv`` from the Flemish
// "Overleg richtlijn grondsoortbenaming" working group (2026-05). Each entry
// carries the Dutch source name (`source`), a concise English label
// (`label`) for the borelog legend, and a fill colour grouped by DOV
// classification (`sedim los`, `carbonaat gest.`, `vulkaniet`, ...) so codes
// the table doesn't yet style still get a sensible hue.
//
// Note: per project memory rule "Never hardcode translations in domain or
// import code" — translation lives ONLY at this presentation boundary; the
// raw DOV token is what the domain stores.

export interface SoilStyle {
  /** CSS-compatible fill colour. */
  fill: string
  /** Concise English label (used in the borelog legend). */
  label: string
  /** Original Dutch source label from DOV's codetabel_hoofdnaam.csv. */
  source?: string
}

const FALLBACK: SoilStyle = { fill: '#cccccc', label: 'unknown' }

// Family palettes. Keep narrow so codes within a class look related.
const C = {
  sandTan:    '#f5e0a4', // generic sand
  sandFine:   '#f5e0a4',
  sandMedium: '#f0c668',
  sandCoarse: '#e6b14d',
  gravel:     '#c9a97a',
  silt:       '#c9b88d',
  loam:       '#a08868',
  clay:       '#7d8da0',
  sludge:     '#6b6f72',
  carbonate:  '#e8e6d8', // lime / chalk / marl
  carbonateDk:'#c9c5a8',
  evaporite:  '#f3efe2',
  iron:       '#a0522d', // rust
  ironDk:     '#7a3a1a',
  silica:     '#bdbdbd', // chert / flint / radiolarite
  intrusive:  '#cdb4a0', // granite / gabbro / diorite (warm grey-pink)
  volcanic:   '#5a4a52', // basalt / rhyolite / tuff (dark)
  volcanicLt: '#8e7d83',
  metamorph:  '#7a8b78', // gneiss / schist / phyllite (greenish-grey)
  metamorphDk:'#4a5a48',
  organicDk:  '#3d2a18', // peat / lignite
  organic:    '#5b4530', // humus / wood / charcoal
  shells:     '#e6dfc8',
  fossil:     '#d8d2c0',
  glauconite: '#6b8e23',
  mineral:    '#8a7a5a',
  anthro:     '#9aa0a8', // anthropogenic / disturbed
  anthroBuild:'#b0978a', // brick / concrete / asphalt
  rubble:     '#8b8478',
  weather:    '#c9a36c', // weathering products (laterite / bauxite)
  rock:       '#7c7c7c', // generic / unknown rock
  topsoil:    '#5b3a1f',
  stones:     '#5a5a5a',
} as const

export const SOIL_COLORS: Record<string, SoilStyle> = {
  // ---- waste / anthropogenic ------------------------------------------------
  AF: { fill: C.anthro,      label: 'waste',                    source: 'afval' },
  GA: { fill: C.anthro,      label: 'disturbed/reworked',       source: 'geroerd / gestoord' },
  AN: { fill: C.anthro,      label: 'clay (anthropogenic)',     source: 'ant. n. vloeistofd.' },
  AV: { fill: C.anthro,      label: 'clay (anthropogenic)',     source: 'ant. vloeistofdicht' },
  AW: { fill: C.anthro,      label: 'clay (anthropogenic)',     source: 'ant. w. vloeistofd.' },
  BK: { fill: C.anthroBuild, label: 'brick',                    source: 'baksteen' },
  BT: { fill: C.anthroBuild, label: 'concrete',                 source: 'beton' },
  AT: { fill: '#2c2c2c',     label: 'asphalt',                  source: 'asfalt' },
  PU: { fill: C.rubble,      label: 'rubble',                   source: 'puin' },
  TA: { fill: C.topsoil,     label: 'topsoil',                  source: 'teelaarde' },

  // ---- loose sediments — sands ---------------------------------------------
  FZ: { fill: C.sandFine,    label: 'fine sand',                source: 'fijn zand' },
  MZ: { fill: C.sandMedium,  label: 'medium sand',              source: 'middelmatig zand' },
  GZ: { fill: C.sandCoarse,  label: 'coarse sand',              source: 'grof zand' },
  XZ: { fill: C.sandTan,     label: 'sand',                     source: 'zand' },
  ZL: { fill: '#bf9d62',     label: 'sandy loam',               source: 'zandleem' },

  // ---- loose sediments — gravels -------------------------------------------
  FG: { fill: '#b59870',     label: 'fine gravel',              source: 'fijn grind' },
  MG: { fill: C.gravel,      label: 'medium gravel',            source: 'middelmatig grind' },
  GG: { fill: '#a37f4f',     label: 'coarse gravel',            source: 'grof grind' },
  XG: { fill: C.gravel,      label: 'gravel',                   source: 'grind' },

  // ---- loose sediments — fine fractions ------------------------------------
  SI: { fill: C.silt,        label: 'silt',                     source: 'silt' },
  KL: { fill: C.clay,        label: 'clay',                     source: 'klei' },
  LE: { fill: C.loam,        label: 'loam',                     source: 'leem' },
  ME: { fill: C.carbonateDk, label: 'marl',                     source: 'mergel' },
  SL: { fill: C.sludge,      label: 'sludge / mud',             source: 'slib' },

  // ---- organic --------------------------------------------------------------
  VE: { fill: C.organicDk,   label: 'peat',                     source: 'veen' },
  HU: { fill: C.organic,     label: 'humus',                    source: 'humus' },
  HT: { fill: '#6b4423',     label: 'wood remains',             source: 'houtresten' },
  HC: { fill: '#2c1810',     label: 'charcoal',                 source: 'houtskool' },
  CO: { fill: '#1a1a1a',     label: 'coal',                     source: 'steenkool' },
  LG: { fill: '#3d2a18',     label: 'lignite',                  source: 'ligniet' },
  PC: { fill: '#1a1a1a',     label: 'coal dust',                source: 'poederkool' },
  AG: { fill: '#888888',     label: 'ash',                      source: 'as' },
  OM: { fill: C.organic,     label: 'organic material',         source: 'organisch materiaal' },
  PL: { fill: '#5b6b3a',     label: 'plant remains',            source: 'plantenresten' },

  // ---- carbonates -----------------------------------------------------------
  KA: { fill: C.carbonate,   label: 'lime',                     source: 'kalk' },
  KS: { fill: C.carbonate,   label: 'limestone',                source: 'kalksteen' },
  KB: { fill: C.carbonateDk, label: 'limestone breccia',        source: 'kalksteenbreccie' },
  KR: { fill: '#fafafa',     label: 'chalk',                    source: 'krijt' },
  KC: { fill: C.carbonateDk, label: 'calcareous schist',        source: 'kalkschiefer' },
  DL: { fill: '#d8d4c0',     label: 'dolomite',                 source: 'dolomiet' },
  DK: { fill: '#d8d4c0',     label: 'dolomitic limestone',      source: 'dolom kalksteen' },
  OK: { fill: C.carbonate,   label: 'oolitic limestone',        source: 'oölitische kalksteen' },
  SK: { fill: C.carbonateDk, label: 'schistose limestone',      source: 'schieferige kalkst.' },
  CA: { fill: C.carbonateDk, label: 'carbonate fragments',      source: 'carbonaatfragmenten' },
  WA: { fill: C.carbonate,   label: 'wackestone',               source: 'wacksteen' },
  TS: { fill: '#dfd6b3',     label: 'tuffeau',                  source: 'tufsteen (tuffeau)' },

  // ---- shells & fossils -----------------------------------------------------
  SC: { fill: C.shells,      label: 'shells',                   source: 'schelpen' },
  SF: { fill: C.shells,      label: 'shell fragments',          source: 'schelpfragmenten' },
  SG: { fill: '#d6cfba',     label: 'shell grit',               source: 'schelpgruis' },
  NN: { fill: C.fossil,      label: 'nummulites',               source: 'nummulieten' },
  FO: { fill: C.fossil,      label: 'fossils',                  source: 'fossielen' },

  // ---- silica gesteenten ----------------------------------------------------
  CT: { fill: C.silica,      label: 'banded chert',             source: 'chert (gebande)' },
  DB: { fill: C.silica,      label: 'diatomite',                source: 'diatomiet' },
  RA: { fill: C.silica,      label: 'radiolarite',              source: 'radiolariet' },
  SX: { fill: '#3a3a3a',     label: 'flint',                    source: 'silex' },
  VS: { fill: '#3a3a3a',     label: 'flint',                    source: 'vuursteen' },
  QU: { fill: '#e8e0d0',     label: 'quartz',                   source: 'kwarts' },

  // ---- iron deposits --------------------------------------------------------
  AD: { fill: C.iron,        label: 'ankerite',                 source: 'ankeriet' },
  HB: { fill: C.ironDk,      label: 'hematite',                 source: 'hematiet' },
  IA: { fill: C.iron,        label: 'oolitic ironstone',        source: 'ijzerooliet' },
  LI: { fill: C.iron,        label: 'limonite',                 source: 'limoniet' },
  SA: { fill: C.iron,        label: 'siderite',                 source: 'sideriet' },
  FE: { fill: '#7a3a1a',     label: 'iron',                     source: 'ijzer' },

  // ---- evaporites -----------------------------------------------------------
  AC: { fill: C.evaporite,   label: 'anhydrite',                source: 'anhydriet' },
  EA: { fill: C.evaporite,   label: 'evaporite',                source: 'evaporiet' },
  GC: { fill: C.evaporite,   label: 'gypsum',                   source: 'gips' },
  HA: { fill: C.evaporite,   label: 'halite',                   source: 'haliet' },

  // ---- volcanic -------------------------------------------------------------
  AB: { fill: C.volcanicLt,  label: 'andesite',                 source: 'andesiet' },
  BA: { fill: C.volcanic,    label: 'basalt',                   source: 'basalt' },
  DA: { fill: C.volcanicLt,  label: 'dacite',                   source: 'daciet' },
  GS: { fill: '#5a6e4a',     label: 'greenstone',               source: 'groensteen' },
  KO: { fill: C.volcanic,    label: 'komatiite',                source: 'komatiet' },
  PM: { fill: '#aa9988',     label: 'pumice',                   source: 'puimsteen' },
  RB: { fill: C.volcanicLt,  label: 'rhyolite',                 source: 'rhyoliet' },
  SO: { fill: C.volcanic,    label: 'scoria',                   source: 'scoria' },
  TB: { fill: '#a89588',     label: 'tuff',                     source: 'tuff' },
  VA: { fill: C.volcanic,    label: 'volcanic rock',            source: 'vulkanisch gesteente' },

  // ---- intrusive ------------------------------------------------------------
  DC: { fill: C.intrusive,   label: 'diorite',                  source: 'dioriet' },
  DD: { fill: C.intrusive,   label: 'dolerite',                 source: 'dolerriet' },
  DE: { fill: '#8b7a6c',     label: 'dunite',                   source: 'duniet' },
  GB: { fill: '#8b7a6c',     label: 'gabbro',                   source: 'gabbro' },
  GE: { fill: C.intrusive,   label: 'granite',                  source: 'graniet' },
  GF: { fill: C.intrusive,   label: 'granodiorite',             source: 'granodioriet' },
  IN: { fill: C.intrusive,   label: 'intrusive rock',           source: 'intrusief gesteente' },
  PA: { fill: C.intrusive,   label: 'pegmatite',                source: 'pegmatiet' },
  PB: { fill: '#7a6c5a',     label: 'peridotite',               source: 'peridodiet' },
  PD: { fill: '#7a6c5a',     label: 'pyroxenite',               source: 'pyroxeniet' },

  // ---- metamorphic ----------------------------------------------------------
  AA: { fill: C.metamorph,   label: 'amphibolite',              source: 'amfiboliet' },
  BS: { fill: '#4a607a',     label: 'blueschist',               source: 'blauwshist' },
  EC: { fill: C.metamorphDk, label: 'eclogite',                 source: 'eclogiet' },
  FY: { fill: C.metamorph,   label: 'phyllite',                 source: 'fylliet' },
  GD: { fill: C.metamorph,   label: 'gneiss',                   source: 'gneiss' },
  GH: { fill: '#6a8a6a',     label: 'greenschist',              source: 'groenshist' },
  GM: { fill: C.metamorph,   label: 'foliated metamorphic',     source: 'gespleten metamorf' },
  HD: { fill: C.metamorphDk, label: 'hornfels',                 source: 'hornfels' },
  KW: { fill: '#d0c8b8',     label: 'quartzite',                source: 'kwartsiet' },
  LS: { fill: '#5a5a6a',     label: 'slate',                    source: 'leisteen' },
  MA: { fill: '#f0eee8',     label: 'marble',                   source: 'marmer' },
  MB: { fill: C.metamorph,   label: 'micaschist',               source: 'micashist' },
  MI: { fill: C.metamorph,   label: 'migmatite',                source: 'migmatiet' },
  MM: { fill: C.metamorph,   label: 'metamorphic rock',         source: 'metamorf gesteente' },
  MS: { fill: C.metamorph,   label: 'schist',                   source: 'schiefer' },
  MY: { fill: C.metamorphDk, label: 'mylonite',                 source: 'myloniet' },
  SP: { fill: '#5a6e58',     label: 'serpentinite',             source: 'serpentiniet' },
  SY: { fill: C.metamorph,   label: 'schist',                   source: 'shist' },
  ZE: { fill: '#9aa68a',     label: 'soapstone',                source: 'zeepsteen' },

  // ---- lithified sediment ---------------------------------------------------
  AR: { fill: '#b89878',     label: 'arenite',                  source: 'areniet' },
  AE: { fill: '#b89878',     label: 'arkose',                   source: 'arkose' },
  CB: { fill: '#a88868',     label: 'conglomerate / breccia',   source: 'conglomeraat/breccie' },
  KT: { fill: '#8a8a98',     label: 'claystone',                source: 'kleisteen' },
  PS: { fill: '#b89878',     label: 'psammite',                 source: 'psammiet' },
  SE: { fill: '#a88868',     label: 'sedimentary',              source: 'sedimentair' },
  SH: { fill: '#7a6e5e',     label: 'shale',                    source: 'schalie' },
  SS: { fill: '#a88868',     label: 'siltstone',                source: 'siltsteen' },
  ZS: { fill: '#8b6f47',     label: 'sandstone',                source: 'zandsteen' },

  // ---- weathering products --------------------------------------------------
  BB: { fill: C.weather,     label: 'bauxite',                  source: 'bauxiet' },
  BC: { fill: '#9a9075',     label: 'bentonite',                source: 'bentoniet' },
  LA: { fill: '#a06f3a',     label: 'laterite',                 source: 'lateriet' },

  // ---- minerals -------------------------------------------------------------
  GI: { fill: '#aaa28a',     label: 'micas',                    source: 'glimmers' },
  PY: { fill: '#a89060',     label: 'pyrite',                   source: 'pyriet' },

  // ---- phosphate ------------------------------------------------------------
  FA: { fill: '#9a8b6a',     label: 'phosphorite',              source: 'fosforiet' },

  // ---- distinctive others ---------------------------------------------------
  GL: { fill: C.glauconite,  label: 'glauconite',               source: 'glauconiet' },
  SN: { fill: '#6e5a4a',     label: 'stone fragments',          source: 'steenfragmenten' },
  ST: { fill: C.stones,      label: 'stones',                   source: 'stenen' },
  RO: { fill: C.rock,        label: 'rock',                     source: 'rots' },
  RV: { fill: '#9a8868',     label: 'weathered rock',           source: 'verweerde rots' },
  XX: { fill: '#cccccc',     label: 'unknown',                  source: 'onbekend' },
}

/**
 * Resolve a DOV soil-token to its render style (fill colour + English label).
 *
 * Returns the FALLBACK style for empty / unrecognised tokens — the borelog
 * always renders something visible regardless of dictionary coverage.
 */
export function soilStyle(code: string | null | undefined): SoilStyle {
  if (!code) return FALLBACK
  return SOIL_COLORS[code] ?? FALLBACK
}
