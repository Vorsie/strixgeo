// Detailvensters en dialoogvensters die vanuit meer dan één stap bereikbaar
// zijn — kaart, boorstaat, labproeven, peileditor, samenstellings- en
// formatiekiezers, gedeelde bevestigingsvensters, ongedaan-maken-labels,
// sneltoetsenoverzicht.
//
// Part of the Dutch (BE) message catalogue — see 'locales/nl/index.ts'.

export const PANELS_NL = {
  // -------------------------------------------------------------------------
  // kaart
  // -------------------------------------------------------------------------
  'map.basemap': 'Achtergrondkaart',
  'map.terrain': 'Terrein',
  // NOTE: ruled 2026-08-27 — owner chose "Transparantie".
  'map.opacity': 'Transparantie',
  'map.visibleOnMap': 'Zichtbaar op de kaart',
  'map.boreholeType': 'Boortype',
  'map.borehole': 'Boring',
  'map.editMetadata': 'Gegevens bewerken',
  'map.drawSectionLine': 'Klik twee punten op de kaart om de profiellijn te tekenen',
  'map.noValuesForAxis': 'Geen waarden voor deze as.',

  // -------------------------------------------------------------------------
  // boorstaat + sondeergrafiek
  // -------------------------------------------------------------------------
  // NOTE: "Boring" here is the DOV header field name, kept verbatim.
  'borelog.boring': 'Boring',
  'borelog.date': 'Datum',
  'borelog.executor': 'Uitvoerder',
  'borelog.method': 'Methode',
  'borelog.waterAt': 'Water op',
  'borelog.drillMethod': 'Boormethode',
  // NOTE: ruled 2026-08-27 — owner chose "Veldbeschrijving".
  'borelog.fieldLog': 'Veldbeschrijving',
  'borelog.stratigraphy': 'Stratigrafie',
  'borelog.lithologyCodes': 'Lithologiecodes',
  'borelog.labTests': 'Labproeven',
  'borelog.clickSampleToView': 'klik op een monster om te bekijken',
  'borelog.samplesAndLabTests': 'Monsters + labproeven',
  'borelog.toggleColumns': 'Kolommen tonen/verbergen',
  'borelog.toggleColumnsHint': 'Toon of verberg kolommen van de boorstaat',
  'borelog.followSection': 'Profiel volgen',
  'borelog.toggleVirtueleBoring': 'DOV Virtuele Boring-overlay aan/uit',
  'borelog.dovOverlayModel': 'DOV-overlaymodel voor dit venster',
  'borelog.overrideDovModel': 'Kies zelf welk DOV-model dit venster toont',
  'borelog.loadingDovPredictions': 'DOV-voorspellingen laden',
  'borelog.zoomInVertical': 'Inzoomen (verticale schaal)',
  'borelog.zoomOutVertical': 'Uitzoomen (verticale schaal)',
  'borelog.resetZoom1x': 'Zoom herstellen naar 1×',
  // FLAG alt: Maaiveldpeil ontbreekt | Hoogte maaiveld ontbreekt — this is the
  // "needs Z" state: without a collar level the log has no mTAW axis.
  'borelog.noSurfaceElevation':
    'Maaiveldpeil ontbreekt — de boorstaat wordt getekend zonder absolute peilas.',
  'chart.zMissing': 'Z ontbreekt',

  // -------------------------------------------------------------------------
  // labproeven
  // -------------------------------------------------------------------------
  'lab.sample': 'Monster',
  'lab.grainSize': 'Korrelverdeling',
  'lab.identificationTests': 'Onderkenningsproeven',
  'lab.otherLabTests': 'Andere labproeven',
  'lab.noTestsForSample': 'Geen labproeven geregistreerd voor dit monster.',
  'lab.curveNotRecorded': 'Curve niet geregistreerd.',
  'lab.atterberg': 'Atterberg',
  'lab.cobbles': 'Keien',

  // -------------------------------------------------------------------------
  // peileditor
  // -------------------------------------------------------------------------
  'elevation.edit': 'Maaiveldpeil bewerken',
  'elevation.set': 'Peil instellen',
  'elevation.addHint':
    'Voeg een maaiveldpeil toe zodat dit onderzoek met andere gecorreleerd kan worden',
  'elevation.clearHint': "Peil wissen — de regel keert terug naar de toestand 'Z ontbreekt'",
  'elevation.verticalReference': 'Verticaal referentiestelsel',
  'elevation.saveEnter': 'Opslaan (Enter)',
  'elevation.cancelEsc': 'Annuleren (Esc)',
  'elevation.saveFailed': 'Opslaan mislukt',

  // -------------------------------------------------------------------------
  // samenstelling + formatiekiezers
  // -------------------------------------------------------------------------
  'composition.topOfWhichLithoUnit': 'Top van welke litho-eenheid?',
  // NOTE: "hoofdnaam" is the DOV field name for the main soil type — the same
  // word the source data uses, so it needs no translation decision.
  'composition.mainLithology': 'Hoofdlithologie',
  'composition.mainSoil': 'Hoofdgrondsoort',
  'composition.admixtures': 'Bijmengingen',
  'composition.addAdmixture': 'Bijmenging toevoegen',
  'composition.removeAdmixture': 'Bijmenging verwijderen',
  'composition.admixtureSoilCode': 'Grondsoortcode van de bijmenging',
  'composition.admixtureAmount': 'Hoeveelheid bijmenging',
  'composition.noAdmixtures': 'Geen bijmengingen.',
  'composition.preview': 'Voorbeeld',
  'composition.save': 'Samenstelling opslaan',
  'composition.fixedByCorrelation': '(vastgelegd door de correlatiegroep)',
  'formation.topOfWhichFormation': 'Top van welke formatie?',
  'formation.newHere': 'Hier een nieuwe formatie',
  'formation.newHereHint':
    'Maak een nieuwe formatie aan en leg deze laaggrens in één stap vast',
  'formation.fromBoreholes': 'Uit de boringen',
  'formation.noneDefined':
    'Nog geen formaties vastgelegd — maak er een aan met de knop hieronder',
  'formation.blurb':
    'Een formatie is een substraateenheid waarnaar je in de interpretatie verwijst.',
  'formation.namePlaceholder': 'bv. Boom Klei',
  'formation.codePlaceholder': 'bv. code uit de stratigrafische tabel',
  'formation.lensCodeHint': '(optioneel — bepaalt de lenscode)',
  'formation.searchFormal': 'Zoek een formele eenheid (bv. Holoceen, QH)…',
  'formation.notInModel': ' — formatie zit niet in je model.',

  // -------------------------------------------------------------------------
  // gedeelde bevestigingsvensters
  // -------------------------------------------------------------------------
  'dialog.cptRefreshStored': 'Opgeslagen',
  'dialog.cptRefreshThisFile': 'Dit bestand',
  'dialog.cptRefreshReadings': 'Metingen',
  'dialog.cptRefreshReplace': 'Gegevens vervangen',
  'dialog.dedupeTitle': 'Dubbele laaggrenzen verwijderen?',
  'dialog.dedupeConfirm': 'Duplicaten verwijderen',
  'dialog.dedupeNothing':
    'Niets in de hier geladen laaggrenzen ziet eruit als een duplicaat. De opschoning zou niets veranderen.',
  'dialog.dedupeRule':
    'Uit elk paar blijft er één over: een handmatig geplaatste keuze wint altijd van een automatisch afgeleide.',
  'dialog.reCorrelateTitle': 'Autocorrelatie vond bestaande verbindingen',
  'dialog.reCorrelateRerun':
    'Opnieuw correleren — automatische verbindingen verwijderen en opnieuw uitvoeren',
  'dialog.reCorrelateSkip': 'Overslaan — bestaande behouden',
  'dialog.reCorrelateNote':
    'Handmatige verbindingen — en voorstellen van andere profielen — blijven hoe dan ook bewaard.',
  'dialog.snapTitle': 'Vastklikken op de geologische laaggrens?',
  'dialog.snapLithoToGeo': 'Litho op geologie vastklikken',
  'dialog.snapGeoToLitho': 'Geologie naar litho verplaatsen',
  'dialog.snapKeepSeparate': 'Annuleren — apart houden',
  'dialog.snapPickContact': 'Kies een geologische laaggrens',
  'dialog.copyCompositionTitle': 'Samenstelling van het doel vervangen?',
  'dialog.copyCompositionReplace': 'Vervangen',
  'dialog.copyCompositionFrom': 'Van:',
  'dialog.copyCompositionTo': 'Naar (nu):',
  'dialog.copyCompositionBody':
    'De doellaag bevat al een bewerking. Vervangen laat de bestaande samenstelling vallen.',
  'dialog.moveRestatedTitle': 'Toch verplaatsen',
  'dialog.moveRestatedUndoNote':
    'Eén stap op de ongedaan-maken-stapel. Ctrl+Z zet alles terug.',
  'dialog.crossingPickerTitle': 'In welk dwarsprofiel openen?',
  'dialog.crossingPickerBlurb': 'Kies een dwarsprofiel',
  'dialog.crossingPickerOpen': 'Profiel openen',
  'dialog.recoveryRestore': 'Herstellen',
  'dialog.recoveryNotNow': 'Niet nu',
  'dialog.recoveryDeleteBackup': 'Back-up verwijderen',
  'dialog.recoveryUntouched': 'Je opgeslagen project blijft ongewijzigd.',

  // -------------------------------------------------------------------------
  // ongedaan-maken-labels
  // -------------------------------------------------------------------------
  'undo.createContact': 'Laaggrens aanmaken',
  'undo.deleteContact': 'Laaggrens verwijderen',
  'undo.moveContact': 'Laaggrens verplaatsen',
  'undo.moveBoundary': 'Grens verplaatsen',
  'undo.mergeContactUp': 'Laaggrens naar boven samenvoegen',
  'undo.mergeContactDown': 'Laaggrens naar onder samenvoegen',
  'undo.createSection': 'Dwarsprofiel aanmaken',
  'undo.deleteSection': 'Dwarsprofiel verwijderen',

  // -------------------------------------------------------------------------
  // sneltoetsenoverzicht (F1)
  // -------------------------------------------------------------------------
  // NOTE: ruled 2026-08-27 — owner chose "Bediening & sneltoetsen".
  'cheatsheet.title': 'Bediening & sneltoetsen',
  'cheatsheet.close': 'Overzicht sluiten',
  'cheatsheet.search': 'Gebaren zoeken',
  'cheatsheet.global': 'Algemeen',
  'cheatsheet.listsSidebar': 'Lijsten & zijbalk',
  'cheatsheet.detailPanel': 'Detailvenster (inspector)',
  'cheatsheet.map': 'Kaart',
  'cheatsheet.borelogCharts': 'Boorstaat & grafieken',
  'cheatsheet.escHint':
    'Afhankelijk van de context: dialoogvenster / paneel sluiten · tekenen, slepen of selecteren annuleren · één interactielaag van het profiel afpellen · selectie wissen',
} as const
