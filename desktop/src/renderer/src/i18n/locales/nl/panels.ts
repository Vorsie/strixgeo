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
  'map.legendLabTests': 'Boringen met labproeven',
  'map.boreholeType': 'Boortype',
  'map.borehole': 'Boring',
  'map.editMetadata': 'Gegevens bewerken',
  'map.drawSectionLine': 'Klik twee punten op de kaart om de profiellijn te tekenen',
  'map.noValuesForAxis': 'Geen waarden voor deze as.',
  // DOV-importvoortgangspaneel (getoond in het bbox-importvenster tijdens de
  // SSE-stream).
  // FLAG alt: Voortgang CPT-import | Voortgang van de sondering-import — owner
  // ruling 9 (2026-08-31) says a CPT is "Sondering (CPT)"; compact aria form used.
  'map.cptImportProgress': 'Voortgang sonderingimport',
  'map.boreholeImportProgress': 'Voortgang boringimport',
  'map.importProgressOf': '{label} {done} van {total}',
  'map.importFinishedWithErrors': 'Import voltooid met fouten',
  'map.importComplete': 'Import voltooid',
  'map.imported': 'Geïmporteerd',
  'map.alreadyExisted': 'Bestond al',
  'map.failed': 'Mislukt',
  // FLAG alt: {n} CPT('s) in het project — owner ruling 9 "Sondering (CPT)".
  'map.cptsInProjectOne': '{n} sondering in het project',
  'map.cptsInProjectMany': '{n} sonderingen in het project',
  'map.observationsAttached': 'Observaties gekoppeld',
  'map.samplesAttached': 'Monsters gekoppeld',
  'map.subPhaseFailed': '{label} mislukt',
  'map.dovMissingData': 'DOV heeft deze gegevens niet teruggegeven. De boringen zijn geïmporteerd, maar',
  'map.dovMissingRetry':
    ' voer de import opnieuw uit over hetzelfde gebied om de ontbrekende delen opnieuw te proberen.',
  'map.dovMissingNoRetry':
    ' DOV’s catalogus vermeldt deze wel, maar de eigen dienst geeft niets terug; opnieuw uitvoeren helpt niet. Controleer de boringen op dov.vlaanderen.be.',
  'map.importFailed': 'Import mislukt',

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
  'borelog.sampleCountOne': '{n} monster',
  'borelog.sampleCountMany': '{n} monsters',
  'borelog.toggleColumns': 'Kolommen tonen/verbergen',
  'borelog.toggleColumnsHint': 'Toon of verberg kolommen van de boorstaat',
  'borelog.columns': 'Kolommen',
  'borelog.columnsHidden': 'Kolommen ({n} verborgen)',
  'borelog.hideColumn': 'Kolom verbergen',
  'borelog.trackNotPresent': 'Deze kolom is niet aanwezig op deze boring',
  'borelog.cannotHideLast': 'Kan niet verbergen: dit is de laatste zichtbare kolom',
  'borelog.missingValue': '(ontbreekt)',
  // Weergavelabels van de observatiekolommen — de DOV observation_type-token
  // blijft ruw in het domein; enkel het getoonde label wordt vertaald.
  'borelog.obs.coded_lithology': 'Gecodeerde lithologie',
  'borelog.obs.geotechnical_coding': 'Geotechnische codering',
  'borelog.obs.lithological_description': 'Lithologische beschrijving',
  'borelog.obs.formal_stratigraphy': 'Formele stratigrafie',
  'borelog.obs.informal_stratigraphy': 'Informele stratigrafie',
  'borelog.obs.quaternary_stratigraphy': 'Kwartaire stratigrafie',
  'borelog.obs.hydrogeological_stratigraphy': 'Hydrogeologische stratigrafie',
  'borelog.obs.informal_hydrogeological_stratigraphy':
    'Informele hydrogeologische stratigrafie',
  'borelog.followSection': 'Profiel volgen',
  'borelog.toggleVirtueleBoring': 'DOV Virtuele Boring-overlay aan/uit',
  'borelog.dovPickModelHint':
    'Kies een DOV-model in de keuzelijst of het profielvenster om deze overlay in te schakelen',
  'borelog.hideDovOverlay': 'DOV Virtuele Boring-overlay verbergen',
  'borelog.showDovOverlay': 'DOV Virtuele Boring-overlay tonen',
  'borelog.dovOverlayModel': 'DOV-overlaymodel voor dit venster',
  'borelog.overrideDovModel': 'Kies zelf welk DOV-model dit venster toont',
  'borelog.loadingDovPredictions': 'DOV-voorspellingen laden',
  'borelog.dovUnavailable': 'DOV-lagenmodellen niet beschikbaar',
  'borelog.stratigraphicBoundaries': 'Stratigrafische grenzen',
  'borelog.lithologicalBoundaries': 'Lithologische grenzen',
  'borelog.zoomInVertical': 'Inzoomen (verticale schaal)',
  'borelog.zoomOutVertical': 'Uitzoomen (verticale schaal)',
  'borelog.resetZoom1x': 'Zoom herstellen naar 1×',
  // FLAG alt: Maaiveldpeil ontbreekt | Hoogte maaiveld ontbreekt — this is the
  // "needs Z" state: without a collar level the log has no mTAW axis.
  'borelog.noSurfaceElevation':
    'Maaiveldpeil ontbreekt. De boorstaat wordt getekend zonder absolute peilas.',
  // DOV Virtuele Boring-overlay + monster/grondwater-helpers op de SVG.
  'borelog.noData': 'geen gegevens',
  'borelog.waterMarker': '▾ water op {depth} m',
  'borelog.labTestCountOne': '{n} labproef',
  'borelog.labTestCountMany': '{n} labproeven',
  'borelog.noTests': 'geen proeven',
  'borelog.hideColumnAria': 'Kolom {title} verbergen',
  'chart.zMissing': 'Z ontbreekt',
  // Samenvattingsregel van de sondeergrafiek, legende + recharts as-/tooltipchrome.
  // FLAG alt: {type} · {rows} metingen · {depth} m — "rows"=data-rijen; "metingen"
  // matches the refresh-dialog wording ("Readings"→"Metingen").
  'chart.runSummary': '{type} · {rows} rijen · {depth} m',
  'chart.preDrill': 'Voorboring {depth} m',
  'chart.lengthAxis': 'Lengte (m)',
  'chart.depthAxis': 'Diepte (m)',
  'chart.levelAxis': 'Peil ({datum})',
  'chart.surfaceRef': '{level} m (maaiveld)',
  'chart.tooltipDepth': 'Diepte: {depth} m',
  'chart.tooltipLevelSuffix': '  |  Peil: {level}',
  'chart.invertRfAxis': 'Rf-as omkeren',

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
  // Labproefpaneel — monsterheader-navigatie, korrelgrafiekchrome + behandelingen.
  'lab.unnumbered': '(ongenummerd)',
  'lab.previousSample': 'Vorige: {name}',
  'lab.noPreviousSample': 'Geen vorig monster',
  'lab.nextSample': 'Volgende: {name}',
  'lab.noNextSample': 'Geen volgend monster',
  'lab.methodsCombined': '{n} methoden gecombineerd',
  'lab.methodN': 'Methode {n}',
  'lab.limeRemoved': 'kalk verwijderd',
  'lab.organicsRemoved': 'organisch materiaal verwijderd',
  // FLAG alt: % doorval — "% finer" is the cumulative passing curve; "% fijner"
  // is literal, "% doorval" is the common BE grading-curve term.
  'lab.pctFiner': '% fijner',
  // "Diameter" is identical BE Dutch (loanword) — intentionally NL == EN.
  'lab.diameterAxis': 'Diameter (mm)',

  // -------------------------------------------------------------------------
  // peileditor
  // -------------------------------------------------------------------------
  'elevation.edit': 'Maaiveldpeil bewerken',
  'elevation.set': 'Peil instellen',
  'elevation.addHint':
    'Voeg een maaiveldpeil toe zodat dit onderzoek met andere gecorreleerd kan worden',
  'elevation.clearHint': "Peil wissen: de regel keert terug naar de toestand 'Z ontbreekt'",
  'elevation.verticalReference': 'Verticaal referentiestelsel',
  'elevation.saveEnter': 'Opslaan (Enter)',
  'elevation.cancelEsc': 'Annuleren (Esc)',
  'elevation.saveFailed': 'Opslaan mislukt',
  'elevation.sourceTitle': 'Peilbron: {source}',
  'elevation.sourceManual': 'handmatig',
  'elevation.clear': 'Wissen',
  'elevation.enterANumber': 'Voer een getal in',
  'elevation.outOfRange': 'Buiten bereik',

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
  'composition.locally': 'plaatselijk',
  // FLAG alt: Bijmengingen van dit lichaam bewerken — "body" = litholichaam per
  // glossary; "dit litholichaam" is precise but long for a dialog title.
  'composition.editAdmixturesTitle': 'Bijmengingen van dit litholichaam bewerken',
  'composition.editSuggestionTitle': 'Samenstelling van het voorstel bewerken',
  'composition.within': 'binnen:',
  'composition.parentAutoResolved':
    'De bovenliggende stratigrafische formatie wordt automatisch bepaald wanneer de laaggrens wordt vastgelegd. Als hier geen stratigrafie gekarteerd is, verschijnt de eenheid onder "Niet toegewezen".',
  'composition.unassigned': 'Niet toegewezen',
  'composition.tabExisting': 'Bestaande eenheden',
  'composition.tabNew': 'Nieuwe eenheid',
  'composition.noUnitsInFormation':
    'Nog geen litho-eenheden in deze stratigrafische formatie. Gebruik het tabblad "Nieuwe eenheid" om er een aan te maken.',
  'composition.noUnitsInModel':
    'Nog geen litho-eenheden in dit model. Gebruik het tabblad "Nieuwe eenheid" om de eerste aan te maken.',
  'composition.under': 'onder {name}',
  'composition.creating': 'Aanmaken…',
  'composition.createUnit': 'Eenheid aanmaken',
  'formation.topOfWhichFormation': 'Top van welke formatie?',
  'formation.newHere': 'Hier een nieuwe formatie',
  'formation.newHereHint':
    'Maak een nieuwe formatie aan en leg deze laaggrens in één stap vast',
  'formation.fromBoreholes': 'Uit de boringen',
  'formation.noneDefined':
    'Nog geen formaties vastgelegd. Maak er een aan met de knop hieronder',
  'formation.blurb':
    'Een formatie is een substraateenheid waarnaar je in de interpretatie verwijst.',
  'formation.namePlaceholder': 'bv. Boom Klei',
  'formation.codePlaceholder': 'bv. code uit de stratigrafische tabel',
  'formation.lensCodeHint': '(optioneel: bepaalt de lenscode)',
  'formation.searchFormal': 'Zoek een formele eenheid (bv. Holoceen, QH)…',
  'formation.notInModel': ' (formatie zit niet in je model).',
  // FormationDialog (aanmaken/bewerken) + FormationPickerDialog-chrome.
  'formation.editTitle': 'Formatie bewerken',
  'formation.newTitle': 'Nieuwe formatie',
  'formation.dialogBlurb':
    'Een formatie is een substraateenheid waarnaar je in het stratigrafische model verwijst, bv.',
  'formation.exampleQuaternary': 'Kwartaire afzettingen',
  'formation.colour': 'Kleur',
  'formation.regionalReference': 'Regionale referentie',
  'formation.formalStratigraphy': 'Formele stratigrafie',
  'formation.clear': 'Wissen',
  'formation.noneDefinedPickerPre':
    'Nog geen formaties vastgelegd. Maak er een aan met de knop hieronder of gebruik',
  // FLAG alt: in het venster Geologie — "Ground model pane" = the geology stage;
  // "Grondmodel" keeps the product concept, "Geologie" matches the stage rail.
  'formation.noneDefinedPickerPost': 'in het venster Grondmodel.',

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
    'Niets in de hier geladen laaggrenzen ziet eruit als een duplicaat. De opschoning toetst opnieuw aan het opgeslagen model en verwijdert wat ze vindt.',
  'dialog.dedupeRule':
    'Uit elk paar blijft er één over: een handmatig geplaatste keuze wint altijd van een automatisch geplaatste, en tussen twee van dezelfde soort wint degene die nog aan een boorlaag gekoppeld is, daarna de nieuwste.',
  // Zin met het aantal verwijderingen, gesplitst zodat het vetgedrukte aantal en
  // de paar-zin elk apart in enkel- of meervoud gaan.
  'dialog.dedupeCountOne': '{n} laaggrens',
  'dialog.dedupeCountMany': '{n} laaggrenzen',
  'dialog.dedupePairsOne':
    'worden definitief verwijderd, verspreid over {pairs} onderzoek-en-formatiepaar dat meer dan één keuze draagt.',
  'dialog.dedupePairsMany':
    'worden definitief verwijderd, verspreid over {pairs} onderzoek-en-formatieparen die meer dan één keuze dragen.',
  'dialog.dedupeUndo':
    'Dit kan niet ongedaan gemaakt worden. Niets zet een verwijderde laaggrens terug. Het project sluiten zonder opslaan zet het hele project terug naar de laatste bewaaractie.',
  'dialog.reCorrelateTitle': 'Autocorrelatie vond bestaande verbindingen',
  'dialog.reCorrelateRerun':
    'Opnieuw correleren: automatische verbindingen verwijderen en opnieuw uitvoeren',
  'dialog.reCorrelateSkip': 'Overslaan: bestaande behouden',
  'dialog.reCorrelateNote':
    'Handmatige verbindingen (en voorstellen van andere profielen) blijven hoe dan ook bewaard.',
  // Tekstzin, gesplitst rond het vetgedrukte aantal zodat "{n}" benadrukt kan worden.
  'dialog.reCorrelateBodyPreOne': 'Er is al',
  'dialog.reCorrelateBodyPreMany': 'Er zijn al',
  'dialog.reCorrelateBodyPostOne':
    'automatische correlatieverbinding op dit profiel. Wat wil je doen?',
  'dialog.reCorrelateBodyPostMany':
    'automatische correlatieverbindingen op dit profiel. Wat wil je doen?',
  'dialog.snapTitle': 'Vastklikken op de stratigrafische laaggrens?',
  'dialog.snapLithoToGeo': 'Litho op stratigrafie vastklikken',
  'dialog.snapGeoToLitho': 'Stratigrafie naar litho verplaatsen',
  'dialog.snapKeepSeparate': 'Annuleren: apart houden',
  'dialog.snapPickContact': 'Kies een stratigrafische laaggrens',
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
  // Tekstzin, gesplitst rond het vetgedrukte aantal.
  'dialog.crossingPickerBodyPre': 'De betrokken laaggrenzen komen voor op',
  'dialog.crossingPickerBodyPost': 'dwarsprofielen. Kies er een om ernaartoe te gaan.',
  'dialog.recoveryRestore': 'Herstellen',
  'dialog.recoveryNotNow': 'Niet nu',
  'dialog.recoveryDeleteBackup': 'Back-up verwijderen',
  'dialog.recoveryUntouched': 'Je opgeslagen project blijft ongewijzigd.',
  // Bevestigingsvenster voor CPT-refresh bij herimport. De titel is rond de
  // vetgedrukte CPT-naam gesplitst zodat de zin in het NL kan herschikken.
  // FLAG alt: "Vervang {name}'s gegevens door dit bestand?" — English keeps the
  // name first with a possessive; NL reads better with "Gegevens van {name} …".
  'dialog.cptRefreshTitlePre': 'Gegevens van',
  // Leading space: EN renders "{name}’s data…" (no space); NL needs "{name} vervangen…".
  'dialog.cptRefreshTitlePost': ' vervangen door dit bestand?',
  'dialog.cptRefreshBody':
    ' zit al in dit project. Het importeren vervangt de opgeslagen metingen. Dit kan niet ongedaan gemaakt worden, en elke interpretatie die onder de nieuwe diepte verankerd is, moet gecontroleerd worden.',
  'dialog.cptRefreshWarningsOne': 'Het nieuwe bestand is verwerkt met {n} waarschuwing.',
  'dialog.cptRefreshWarningsMany': 'Het nieuwe bestand is verwerkt met {n} waarschuwingen.',
  // Gedeelde ankersubtitel van de kiezervensters (formatie- + lithokiezer).
  'dialog.pickerAnchorPre': 'Op',
  'dialog.pickerAnchorAt': 'op diepte {depth} m ({taw} m TAW)',

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
  'undo.updateContacts': 'Contacten bijwerken ({n})',
  'undo.copyContacts': 'Contacten kopiëren ({copied})',
  'undo.copyMoveContacts': '{copied} kopiëren en {moved} verplaatsen',
  'undo.correlateContacts': 'Contacten correleren',
  'undo.uncorrelateContacts': 'Correlatie van contacten opheffen',
  'undo.removeFromSection': '{id} uit dwarsprofiel verwijderen',
  'undo.seedFromStratigraphy': 'Vanuit stratigrafie vullen (+{n} contacten)',
  // Formatie-CRUD.
  'undo.createFormation': 'Formatie aanmaken',
  'undo.editFormation': 'Formatie bewerken',
  'undo.recolorFormation': 'Formatiekleur wijzigen',
  'undo.deleteFormation': 'Formatie verwijderen',
  'undo.reorderFormations': 'Formaties herordenen ({n})',
  // Litho-suggestie (ghost) gebaren.
  'undo.moveLithoBoundary': 'Litholaaggrens verplaatsen',
  'undo.editLithoComposition': 'Samenstelling van litholaag bewerken',
  'undo.insertLithoLayer': 'Litholaag invoegen',
  'undo.splitLithoLayer': 'Litholaag splitsen',
  'undo.copyLithoContact': 'Litho-contact kopiëren',
  'undo.copyGhostContact': 'Lithosuggesties kopiëren',
  'undo.mergeLithoLayers': 'Litholagen samenvoegen',
  'undo.absorbLithoLayer': 'Litholaag opnemen',
  'undo.rejectSuggestion': 'Suggestie afwijzen',
  'undo.unrejectSuggestion': 'Suggestie herstellen',
  'undo.createManualGhost': 'Litholaag tekenen',
  'undo.acceptLithoLayer': 'Litholaag accepteren ({soil})',
  'undo.acceptAllLithoLayers': 'Alle litholagen accepteren ({n})',
  'undo.acceptAllLithoLayersAcrossInvestigations': 'Alle litholagen accepteren ({n} onderzoeken)',
  // Vaste litholagen + geotechnische pakkingsbanden.
  'undo.splitLayer': 'Laag splitsen',
  'undo.setPackingClass': 'Pakkingsklasse instellen',
  'undo.movePackingBoundary': 'Pakkingsgrens verplaatsen',
  'undo.splitPackingBand': 'Pakkingsband splitsen',
  'undo.absorbPackingLens': 'Pakkingslens opnemen',
  'undo.absorbPackingRun': 'Pakkingsbanden opnemen',
  'undo.mergePackingBands': 'Pakkingsbanden samenvoegen',
  'undo.disconnectPackingBands': 'Pakkingsbanden loskoppelen',
  // Boring-lidmaatschap + hoogte.
  'undo.includeBoreholeGeo': 'Boring opnemen in model',
  'undo.excludeBoreholeGeo': 'Boring uitsluiten van model',
  'undo.includeBoreholeLitho': 'Boring opnemen in lithologisch model',
  'undo.excludeBoreholeLitho': 'Boring uitsluiten van lithologisch model',
  'undo.editCptElevation': 'CPT-hoogte bewerken',
  'undo.editBoreholeElevation': 'Boringhoogte bewerken',
  'undo.dovImport': 'DOV-import',
  // De vangnet-toast bij een uiteengelopen staat (geen kastlijntje).
  'undo.undoFailed': 'Ongedaan maken mislukt: {action}. Geschiedenis gewist om de staat veilig te houden.',
  'undo.redoFailed': 'Opnieuw uitvoeren mislukt: {action}. Geschiedenis gewist om de staat veilig te houden.',

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
  // FLAG alt: Zoek gebaren — bv. selectievak, alt, zoom — "marquee" = selectiekader.
  'cheatsheet.searchPlaceholder': 'Zoek gebaren, bv. selectiekader, alt, zoom',
  'cheatsheet.noMatch': 'Geen gebaar komt overeen met “{query}”.',
} as const
