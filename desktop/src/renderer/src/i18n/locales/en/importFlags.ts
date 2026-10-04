// Import flags — one sentence per finding code of the DOV borehole XML import
// (``DovBoringFileParser`` + the boring / interpretation parsers it reuses +
// ``ImportBoreholeFile``). The backend sends each finding as code + English
// message + structured ``params``; ``utils/importFlagText.ts`` builds the
// sentence below from the params, so the report reads in the interface
// language (owner dogfeed 2026-10-03: "the flag texts are English inside the
// NL report"). The boring's name is not repeated: the report lists the flags
// under it. Raw DOV values (purpose, reliability, remark text) are quoted as
// the source wrote them — domain tokens are never translated.
//
// Part of the English message catalogue — see 'locales/en/index.ts'.

export const IMPORT_FLAGS = {
  // ---- shared fragments --------------------------------------------------
  'importFlags.p.notGiven': 'not given',
  'importFlags.p.noType': 'no type',
  'importFlags.p.untitled': 'untitled',
  'importFlags.p.noUrl': 'no URL',
  'importFlags.subject.position': 'Position',
  'importFlags.subject.elevation': 'Elevation',
  'importFlags.part.drill_segment': 'drill segment',
  'importFlags.part.color': 'colour interval',
  'importFlags.part.moisture': 'moisture interval',
  'importFlags.part.consistency': 'consistency interval',
  'importFlags.part.layer': 'layer {index}',
  'importFlags.part.sample': 'sample',
  'importFlags.reason.base_not_below_top': 'the base is not below the top',
  'importFlags.reason.invalid_value': 'invalid value',
  'importFlags.place.start': 'starts at {from} m, not at the surface',
  'importFlags.place.gap': 'gap {from} to {to} m',
  'importFlags.place.overlap': 'overlap {from} to {to} m',
  'importFlags.place.more': ' (+{n} more)',

  // ---- one sentence per code ------------------------------------------------
  'importFlags.code.FILE_HOLDS_MANY_BORINGS':
    'the file holds {count} borings; each is imported as its own borehole',
  'importFlags.code.NAME_FROM_ALTERNATIVE':
    "named by its alternative name {alternatives}; DOV identificatie '{testId}'",
  'importFlags.code.NO_LITHOLOGICAL_DESCRIPTION':
    'no lithological description in the file; the borehole has no layers to show or segment',
  'importFlags.code.MULTIPLE_LITHOLOGICAL_DESCRIPTIONS':
    '{count} lithological descriptions; the one with the most layers ({usedLayers}, permkey {usedPermkey}) is used, the others ({otherLayers} layers) are imported as further observations',
  'importFlags.code.STRATIGRAPHY_PRESENT': '{stream} present ({layers} layers, permkey {permkey})',
  'importFlags.code.RELIABILITY_NOT_GOOD': "{subject}: reliability (betrouwbaarheid) is '{reliability}'",
  'importFlags.code.ELEVATION_ZERO':
    'ground elevation is 0.00 m TAW (method: {method}); kept as a real value; check it is not a placeholder',
  'importFlags.code.NO_FIELD_LOG': 'no field log (colour / moisture / consistency) in the file',
  'importFlags.code.DRILLMASTER_UNKNOWN': "drill master (boormeester) is '{drillmaster}'",
  'importFlags.code.DRILLMASTER_UNKNOWN.absent': 'no drill master (boormeester) given',
  'importFlags.code.PURPOSE_NOT_GEOTECHNICAL': "purpose (doel) is '{purpose}', not '{expected}'",
  'importFlags.code.PURPOSE_NOT_GEOTECHNICAL.absent': 'no purpose (doel) given',
  'importFlags.code.REMARK_PRESENT': 'remark: "{remark}"',
  'importFlags.code.ATTACHMENT_PRESENT': "attachment '{title}': {url}",
  'importFlags.code.DEPTH_MISMATCH.drill_segment':
    'total depth (diepte_tot) {total} m but the deepest drill segment ends at {end} m',
  'importFlags.code.DEPTH_MISMATCH.lithological_description':
    'total depth (diepte_tot) {total} m but the lithological description ends at {end} m',
  'importFlags.code.DATE_IN_FUTURE': 'start date (datum_aanvang) {date} is after today ({today})',
  'importFlags.code.GROUNDWATER_ASSUMED':
    'assumed groundwater depth (aangenomengrondwaterstand) {depth}; not imported as the water table (an assumption, not a reading)',
  'importFlags.code.START_DEPTH_NOT_ZERO':
    'the boring starts at {depth} m (diepte_van), not at the surface',
  'importFlags.code.LITHOLOGY_GAPS_OR_OVERLAPS':
    'the used lithological description is not continuous; {count} place(s): {places}',
  'importFlags.code.UNKNOWN_INTERPRETATION_STREAM':
    'interpretation <{tag}> is not a stream this importer knows; not imported',
  'importFlags.code.INTERPRETATION_WITHOUT_BORING':
    "{count} interpretation(s) ({tags}) belong to boring '{boring}', which is not in this file; not imported",
  'importFlags.code.DUPLICATE_BORING_IN_FILE':
    'the file holds this boring twice; the second copy was not imported',
  'importFlags.code.INVALID_INTERVAL': '{part} ({top}–{base} m) skipped: {reason}',
  'importFlags.code.NOT_IMPORTED': 'not imported, the boring has no usable position',
  'importFlags.code.NO_COORDINATES': 'no usable coordinates in the file',
  'importFlags.code.ZERO_COORDINATES': 'X and Y are both 0 (a placeholder position)',
  'importFlags.code.COORDINATES_OUTSIDE_CRS_BOUNDS':
    'coordinates ({x}, {y}) fall outside the area covered by {crs}; check for a swapped X/Y, a wrong coordinate system or a foreign position',
  'importFlags.code.NO_TOTAL_DEPTH': 'no total depth (diepte_tot) in the file',
  'importFlags.code.NO_ELEVATION': 'no ground elevation in the file',
  'importFlags.code.NO_DETAILS': 'no drilling details (details) in the file',
  'importFlags.code.INCOMPLETE_DRILL_SEGMENT':
    'drill segment skipped, a field is missing (from {top}, to {base}, method {method})',
  'importFlags.code.INCOMPLETE_FIELD_LOG':
    '{part} skipped, a field is missing (from {top}, to {base})',
  'importFlags.code.NO_LAYERS': '{stream} has no layers',
  'importFlags.code.INCOMPLETE_LAYER': 'layer {index} skipped, its depths are missing',
  'importFlags.code.SAMPLES_PRESENT':
    '{count} sample(s) in the file, imported with the borehole ({grainSize} grain-size curve(s))',
  'importFlags.code.SAMPLE_WITHOUT_DEPTH': "sample '{sample}' has no depth interval; not imported",
  'importFlags.code.SAMPLE_WITHOUT_BORING':
    "sample '{sample}' belongs to boring '{boring}', which is not in this file; not imported",
  'importFlags.code.SAMPLE_OBSERVATIONS_NOT_IMPORTED':
    "sample '{sample}': {count} lab observation(s) not imported ({parameters}); only grain-size curves are read from a file",
} as const
