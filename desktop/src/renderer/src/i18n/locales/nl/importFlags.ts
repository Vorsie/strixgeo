// Importmeldingen — één zin per meldingscode van de DOV-boring-XML-import.
// ``utils/importFlagText.ts`` vult de zinnen met de gestructureerde params van
// de backend. Ruwe DOV-waarden (doel, betrouwbaarheid, opmerking) blijven zoals
// de bron ze schreef. Een gat in de beschrijving heet een "leemte" (woordkeuze
// van de eigenaar, ook in de modelcontrole).
//
// Part of the Dutch (BE) message catalogue — see 'locales/nl/index.ts'.

export const IMPORT_FLAGS_NL = {
  // ---- gedeelde fragmenten ------------------------------------------------
  'importFlags.p.notGiven': 'niet opgegeven',
  'importFlags.p.noType': 'geen type',
  'importFlags.p.untitled': 'zonder titel',
  'importFlags.p.noUrl': 'geen URL',
  'importFlags.subject.position': 'Positie',
  'importFlags.subject.elevation': 'Hoogte',
  'importFlags.part.drill_segment': 'boortraject',
  'importFlags.part.color': 'kleurinterval',
  'importFlags.part.moisture': 'vochtinterval',
  'importFlags.part.consistency': 'consistentie-interval',
  'importFlags.part.layer': 'laag {index}',
  'importFlags.part.sample': 'monster',
  'importFlags.reason.base_not_below_top': 'de basis ligt niet onder de top',
  'importFlags.reason.invalid_value': 'ongeldige waarde',
  'importFlags.place.start': 'begint op {from} m, niet aan het maaiveld',
  'importFlags.place.gap': 'leemte {from} tot {to} m',
  'importFlags.place.overlap': 'overlapping {from} tot {to} m',
  'importFlags.place.more': ' (+{n} andere)',

  // ---- één zin per code -----------------------------------------------------
  'importFlags.code.FILE_HOLDS_MANY_BORINGS':
    'het bestand bevat {count} boringen; elke boring wordt apart geïmporteerd',
  'importFlags.code.NAME_FROM_ALTERNATIVE':
    "benoemd met de alternatieve naam {alternatives}; DOV-identificatie '{testId}'",
  'importFlags.code.NO_LITHOLOGICAL_DESCRIPTION':
    'geen lithologische beschrijving in het bestand; de boring heeft geen lagen om te tonen of op te delen',
  'importFlags.code.MULTIPLE_LITHOLOGICAL_DESCRIPTIONS':
    '{count} lithologische beschrijvingen; die met de meeste lagen ({usedLayers}, permkey {usedPermkey}) wordt gebruikt, de andere ({otherLayers} lagen) worden als extra observaties ingelezen',
  'importFlags.code.STRATIGRAPHY_PRESENT': '{stream} aanwezig ({layers} lagen, permkey {permkey})',
  'importFlags.code.RELIABILITY_NOT_GOOD': "{subject}: betrouwbaarheid is '{reliability}'",
  'importFlags.code.ELEVATION_ZERO':
    'maaiveldhoogte is 0.00 m TAW (methode: {method}); als echte waarde behouden; controleer of het geen opvulwaarde is',
  'importFlags.code.NO_FIELD_LOG': 'geen veldbeschrijving (kleur / vochtgehalte / consistentie) in het bestand',
  'importFlags.code.DRILLMASTER_UNKNOWN': "boormeester is '{drillmaster}'",
  'importFlags.code.DRILLMASTER_UNKNOWN.absent': 'geen boormeester opgegeven',
  'importFlags.code.PURPOSE_NOT_GEOTECHNICAL': "doel is '{purpose}', niet '{expected}'",
  'importFlags.code.PURPOSE_NOT_GEOTECHNICAL.absent': 'geen doel opgegeven',
  'importFlags.code.REMARK_PRESENT': 'opmerking: "{remark}"',
  'importFlags.code.ATTACHMENT_PRESENT': "bijlage '{title}': {url}",
  'importFlags.code.DEPTH_MISMATCH.drill_segment':
    'einddiepte (diepte_tot) {total} m, maar het diepste boortraject eindigt op {end} m',
  'importFlags.code.DEPTH_MISMATCH.lithological_description':
    'einddiepte (diepte_tot) {total} m, maar de lithologische beschrijving eindigt op {end} m',
  'importFlags.code.DATE_IN_FUTURE': 'startdatum (datum_aanvang) {date} ligt na vandaag ({today})',
  'importFlags.code.GROUNDWATER_ASSUMED':
    'aangenomen grondwaterdiepte (aangenomengrondwaterstand) {depth}; niet als grondwatertafel ingelezen (een aanname, geen meting)',
  'importFlags.code.START_DEPTH_NOT_ZERO':
    'de boring begint op {depth} m (diepte_van), niet aan het maaiveld',
  'importFlags.code.LITHOLOGY_GAPS_OR_OVERLAPS':
    'de gebruikte lithologische beschrijving is niet doorlopend; {count} plaats(en): {places}',
  'importFlags.code.UNKNOWN_INTERPRETATION_STREAM':
    'interpretatie <{tag}> is een onbekend type voor deze import; niet ingelezen',
  'importFlags.code.INTERPRETATION_WITHOUT_BORING':
    "{count} interpretatie(s) ({tags}) horen bij boring '{boring}', die niet in dit bestand zit; niet ingelezen",
  'importFlags.code.DUPLICATE_BORING_IN_FILE':
    'het bestand bevat deze boring twee keer; de tweede kopie is niet ingelezen',
  'importFlags.code.INVALID_INTERVAL': '{part} ({top}–{base} m) overgeslagen: {reason}',
  'importFlags.code.NOT_IMPORTED': 'niet ingelezen, de boring heeft geen bruikbare ligging',
  'importFlags.code.NO_COORDINATES': 'geen bruikbare coördinaten in het bestand',
  'importFlags.code.ZERO_COORDINATES': 'X en Y zijn allebei 0 (een opvulligging)',
  'importFlags.code.COORDINATES_OUTSIDE_CRS_BOUNDS':
    'coördinaten ({x}, {y}) vallen buiten het gebied van {crs}; controleer op verwisselde X/Y, een fout coördinatenstelsel of een buitenlandse ligging',
  'importFlags.code.NO_TOTAL_DEPTH': 'geen einddiepte (diepte_tot) in het bestand',
  'importFlags.code.NO_ELEVATION': 'geen maaiveldhoogte in het bestand',
  'importFlags.code.NO_DETAILS': 'geen boorgegevens (details) in het bestand',
  'importFlags.code.INCOMPLETE_DRILL_SEGMENT':
    'boortraject overgeslagen, een veld ontbreekt (van {top}, tot {base}, methode {method})',
  'importFlags.code.INCOMPLETE_FIELD_LOG':
    '{part} overgeslagen, een veld ontbreekt (van {top}, tot {base})',
  'importFlags.code.NO_LAYERS': '{stream} heeft geen lagen',
  'importFlags.code.INCOMPLETE_LAYER': 'laag {index} overgeslagen, de dieptes ontbreken',
  'importFlags.code.SAMPLES_PRESENT':
    '{count} monster(s) in het bestand, met de boring ingelezen ({grainSize} korrelverdeling(en))',
  'importFlags.code.SAMPLE_WITHOUT_DEPTH': "monster '{sample}' heeft geen diepte-interval; niet ingelezen",
  'importFlags.code.SAMPLE_WITHOUT_BORING':
    "monster '{sample}' hoort bij boring '{boring}', die niet in dit bestand zit; niet ingelezen",
  'importFlags.code.SAMPLE_OBSERVATIONS_NOT_IMPORTED':
    "monster '{sample}': {count} labo-observatie(s) niet ingelezen ({parameters}); uit een bestand worden enkel korrelverdelingen gelezen",

  // ---- pdf-boorstaten (vaststellingen van de digitizer + importmeldingen) ----
  'importFlags.code.CRS_ASSUMED':
    'X/Y zonder coördinatenstelsel gedrukt; gelezen als Lambert 72 (EPSG {epsg}), te bevestigen bij de import',
  'importFlags.code.WATER_UNIT_ASSUMED':
    "grondwaterstand '{value}' zonder eenheid of referentie; gelezen als {depth} m onder maaiveld, te bevestigen bij de import",
  'importFlags.code.REPEAT_DIFFERS':
    'twee keer gedrukt met {count} verschillende rij(en) (andere afdruk {other}); kies welke afdruk je achterhoudt',
  'importFlags.code.REPEAT_DROPPED':
    'opnieuw gedrukt op blz. {pages} met exact dezelfde gegevens; die afdruk is weggelaten',
  'importFlags.code.PDF_BOREHOLE_LEVEL_UNREADABLE':
    "blz. {page}: het niveaulabel '{text}' is geen getal; die grens heeft geen diepte",
  'importFlags.code.PDF_BOREHOLE_LEVEL_COUNT_MISMATCH':
    'blz. {page}: {labels} niveaulabels voor {rules} lijnen; de rijen van dit blad krijgen geen diepte',
  'importFlags.code.PDF_BOREHOLE_LEVELS_NOT_FALLING':
    'blz. {page}: de gedrukte niveaus stijgen ergens op het blad',
  'importFlags.code.PDF_BOREHOLE_NO_GROUND_LEVEL':
    'blz. {page}: geen maaiveldhoogte en geen eerste niveau gedrukt; geen dieptes',
  'importFlags.code.PDF_BOREHOLE_GROUND_LEVEL_FROM_FIRST_LEVEL':
    'blz. {page}: geen maaiveldhoogte in de kop; het eerste niveau {z} m is de top van de boring',
  'importFlags.code.PDF_BOREHOLE_GROUND_LEVEL_DISAGREES':
    'blz. {page}: maaiveldhoogte in de kop {z} m, eerste gedrukte niveau {first} m; de dieptes volgen de kop',
  'importFlags.code.PDF_BOREHOLE_NO_XY': 'geen positie gedrukt; deze boring kan niet geïmporteerd worden',
  'importFlags.code.PDF_BOREHOLE_SHEET_JOIN_TEXT_DIFFERS':
    'blz. {page}: een rij die het vorige blad al dekt ({top}/{base}) draagt een andere tekst; bewaard zoals gedrukt',
  'importFlags.code.PDF_BOREHOLE_OPEN_BASE': 'blz. {page}: de laatste laag heeft geen afsluitend niveau',
  'importFlags.code.PDF_BOREHOLE_EMPTY_DESCRIPTION': 'blz. {page}: een rij tussen twee lijnen draagt geen tekst',
  'importFlags.code.PDF_BOREHOLE_WATER_UNIT_UNPRINTED':
    "grondwaterstand '{value}' is niet te lezen als diepte onder maaiveld; ruw bewaard",
  'importFlags.code.PDF_BOREHOLE_SAMPLE_WITHOUT_AXIS':
    'blz. {page}: monster {sample} gevonden, maar geen diepteas om het te plaatsen',
  'importFlags.code.PDF_BOREHOLE_INTERVAL_NOT_STORED':
    "de laag '{text}' heeft geen leesbaar dieptebereik; niet opgeslagen",
  'importFlags.code.PDF_BOREHOLE_SAMPLE_NOT_STORED':
    'monster {sample} kon niet op de diepteas geplaatst worden; niet opgeslagen',
  'importFlags.code.PDF_BOREHOLE_SAMPLE_ID_CUT':
    "monster-id '{sample}' is langer dan {max} tekens; ingekort, het volledige id staat in de beschrijving",
  'importFlags.code.PDF_BOREHOLE_EDITED_TRACK_KEPT':
    'de beschrijving werd met de hand bewerkt; ze is behouden en de beschrijving uit het rapport is er niet over geschreven',
} as const
