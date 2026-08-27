// Parameter- en exportstap — de twee stappen die het model lezen in plaats van
// het op te bouwen.
//
// Part of the Dutch (BE) message catalogue — see 'locales/nl/index.ts'.

export const OUTPUTS_NL = {
  // -------------------------------------------------------------------------
  // parameters
  // -------------------------------------------------------------------------
  'params.title': 'Parameters & analyses',
  'params.views': 'Parameterweergaven',
  'params.perTest': 'Per proef',
  'params.perUnit': 'Per eenheid',
  'params.methods': 'Methodes',
  'params.pickTab': 'Kies hierboven een tabblad.',
  'params.perTestBlurb': 'Eén regel per sondering / boring / labproef; de kolommen zijn parameters.',
  'params.perUnitBlurb':
    'Eén regel per litho- of geotechnische eenheid; de kolommen vatten de eenheid samen (gemiddelde / P50 / P95 / afgeleide waarden).',
  'params.methodsBlurb':
    'Correlaties (formule) tegenover Excel-opzoekingen (NAD-NEN-tabel) — strikt gescheiden. Plus aanknopingspunten voor probabilistiek en ML.',
  'params.correlations': 'Correlaties',
  'params.correlationsBlurb':
    'Afleidingen op basis van formules uit in-situmetingen. Kies één methode per (parameter, eenheid).',
  'params.excelLookups': 'Excel-opzoekingen',
  'params.nadNenTable': 'NAD-NEN-tabel (38 × 313)',
  'params.projectXlsxImport': 'Projectspecifieke xlsx-import',
  'params.probabilisticMl': 'Probabilistiek + ML',
  'params.probabilisticMlBlurb':
    'Bekabeling van kansverdelingen voor probabilistische ontwerptools, plus een ML-voorstelvlak waarvoor nazicht verplicht is.',
  'params.probabilisticDistributions': 'Kansverdelingen',
  'params.mlSuggestion': 'ML / AI-voorstel',
  'params.noTestSelected': 'Geen proef geselecteerd',
  'params.pickCptRow':
    'Klik op een sondeerregel in de tabel per proef om hier de dieptereeks en het profiel van het grondgedragstype te tekenen.',
  'params.loadingDepthSeries': 'Dieptereeks laden…',
  // FLAG alt: Grondwaterstand | Freatisch niveau — BE practice says
  // "grondwatertafel"; NL practice says "grondwaterstand".
  'params.waterTable': 'Grondwatertafel:',
  'params.waterTableSet': 'Klik om de grondwatertafel voor deze sondering in te stellen',
  'params.waterTableHint': 'Diepte tot het grondwater in meter onder maaiveld',
  'params.waterTableEditHint': 'm — Enter om toe te passen, Esc om te annuleren',
  'params.waterTableUndo':
    'Maak de grondwatertafel die je ingesteld hebt ongedaan — de waarde uit het bestand komt terug wanneer het bestand er een bevatte, anders de aanname van de toepassing',
  // FLAG alt: SBT-zone | grondgedragstype (SBT) — "Soil Behaviour Type" is
  // universally left untranslated in NL geotechnical reports.
  'params.sbtNormalised': 'Genormaliseerde Robertson 2015 SBT-zone',
  'params.sbtNonNormalised': 'Niet-genormaliseerde I_SBT-zone (Robertson 2010)',

  // -------------------------------------------------------------------------
  // export
  // -------------------------------------------------------------------------
  'export.title': 'Exports',
  'export.blurb': 'Geef het grondmodel door aan een ontwerptool verderop in de keten.',
  'export.sections': 'Profielen',
  'export.geology': 'Geologie',
  'export.crossSection': 'Dwarsprofiel',
  'export.crossSectionToExport': 'Te exporteren dwarsprofiel',
  'export.sectionBlurb':
    'Exporteer de laaggeometrie van één dwarsprofiel — DXF (universele CAD-uitwisseling) of een uitvoerbaar Plaxis 2D plxscripting-script met één boring per geprojecteerde kolom.',
  'export.geologyPlaxis3d': 'Geologisch model → Plaxis 3D',
  'export.geologyBlurb':
    'Exporteer het volledige model als een uitvoerbaar plxscripting Python-script — één voorlopige Mohr-Coulomb-grondsoort en één boring per grondonderzoek.',
  'export.noActiveModel':
    'Geen actief geologisch model. Leg eerst formaties vast en plaats laaggrenzen.',
  'export.dxf': 'AutoCAD DXF',
  'export.pythonScript': 'Python-script',
  'export.allFiles': 'Alle bestanden',
  'export.gefFiles': 'GEF-bestanden',
  'export.dStability': 'D-Stability (.stix)',
  'export.dSheetPiling': 'D-Sheet Piling (.shi)',
  'export.dxfFailed': 'Kon de DXF niet exporteren.',
  'export.pdfFailed': 'Kon de PDF niet exporteren.',
  'export.plaxisFailed': 'Kon het Plaxis-script niet exporteren.',
  'export.fenceFailed': 'Kon de profielwand niet exporteren.',
  'export.reportEngineer': 'Naam van de ingenieur',
  'export.reportGenerate': 'PDF van het profiel genereren',
  'export.reportNotes':
    'Optionele vrije tekst die onder de tabel met projectgegevens getoond wordt.',
} as const
