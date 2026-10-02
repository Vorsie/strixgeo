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
    'Correlaties (formule) tegenover Excel-opzoekingen (NAD-NEN-tabel): strikt gescheiden. Plus aanknopingspunten voor probabilistiek en ML.',
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
  'params.waterTableEditHint': 'm. Enter om toe te passen, Esc om te annuleren',
  'params.waterTableUndo':
    'Maak de grondwatertafel die je ingesteld hebt ongedaan. De waarde uit het bestand komt terug wanneer het bestand er een bevatte, anders de aanname van de toepassing',
  // FLAG alt: SBT-zone | grondgedragstype (SBT) — "Soil Behaviour Type" is
  // universally left untranslated in NL geotechnical reports.
  'params.sbtNormalised': 'Genormaliseerde Robertson 2015 SBT-zone',
  'params.sbtNonNormalised': 'Niet-genormaliseerde I_SBT-zone (Robertson 2010)',

  // --- Parameters stage — wired from the stage components (P6 coverage) ---
  'params.phase5Surface':
    'Fase 5-vlak: ontwerpklare parameters (φ′ / c′ / cu / E50 / OCR / Vs / G0 / M) verschijnen zodra correlaties en opzoekingen landen.',
  'params.unknownTab': 'Onbekend parametertabblad',
  'params.gwtRecorded': 'geregistreerd',
  'params.gwtEngineer': 'ingesteld door ingenieur',
  'params.gwtEngineerShort': 'ingenieur',
  'params.gwtAssumed': 'aangenomen',
  'params.waterTableInvalid':
    'De grondwatertafel moet een getal in meter zijn. Negatief als het water boven het maaiveld staat.',
  'params.waterTableSaveFailedDetail': 'Kon de grondwatertafel niet opslaan: {error}',
  'params.waterTableSaveFailed': 'Kon de grondwatertafel niet opslaan.',
  'params.cptLoadFailedDetail': 'Kon deze sondering niet laden: {error}',
  'params.cptLoadFailed': 'Kon deze sondering niet laden.',
  'params.cptFallbackName': 'Sondering',
  'params.depthMDeep': '{depth} m diep',
  'params.depthUnknown': 'diepte onbekend',
  'params.sbtDerivationNote':
    'SBTn genormaliseerd bij grondwatertafel {gwt} m ({source}) · SBT (I_SBT) heeft er geen nodig',
  'params.zoneN': 'zone {n}',
  // FLAG alt: Conusweerstand | Puntweerstand — "conusweerstand" is the DOV/BE
  // term for qc; "puntweerstand" is the older NL word.
  'params.channelQc': 'Conusweerstand',
  'params.channelFs': 'Plaatselijke wrijving',
  'params.channelRf': 'Wrijvingsgetal',
  'params.channelAriaLabel':
    '{title}-verdeling over deze eenheid: mediaan {median} {unit}, {n} monsters',
  'params.notRecordedOnCpts': 'Niet geregistreerd op de sonderingen die deze eenheid dekken.',
  'params.offAxis': '{count} buiten de as',
  'params.marksNotDrawn': '{marks} niet getekend: overspant waarden buiten de as',
  // FLAG alt: snorhaar — box-plot "whisker" is often kept in Dutch technical UIs.
  'params.markWhisker': 'whisker',
  // FLAG alt: doos — box-plot "box" is usually kept in Dutch ("boxplot").
  'params.markBox': 'box',
  'params.statMin': 'min',
  'params.statMedian': 'mediaan',
  'params.statMax': 'max',
  'params.statMean': 'gemiddelde',
  'params.statSd': 'sd',
  'params.standardCptAxes': 'Standaard sondeerassen',
  'params.fitAxesToData': 'Assen aan data aanpassen',
  'params.pooledAxes': 'Gepoolde assen',
  'params.bandsOfTotal': '{n} van {total} banden',
  'params.bandCountOne': '{n} band',
  'params.bandCountMany': '{n} banden',
  'params.onNCpt': 'op {n} sondering',
  'params.onNCpts': 'op {n} sonderingen',
  'params.mOfGround': ' · {thickness} m grond',
  'params.withoutSeries': ' · {count} zonder reeks',
  'params.noConeInBody': 'Geen conusmetingen in dit lichaam',
  'params.noConeInUnit': 'Geen conusmetingen in deze eenheid',
  'params.noConeBodyHint':
    'Dit lichaam heeft geen banden op een sondering. Een lichaam met enkel boringen draagt geen conusweerstand om samen te vatten.',
  'params.noConeUnitHint':
    'Deze eenheid heeft geen banden op een sondering. Een eenheid met enkel boringen draagt geen conusweerstand om samen te vatten.',
  'params.noConeBandsHint': 'De banden zijn er, maar nog geen sondeerreeks dekt ze.',
  'params.characterisationNote':
    'Enkel karakterisatie: de spreiding van de metingen binnen de banden van deze eenheid. Dit zijn geen ontwerpparameters; φ′, c′, cu, E50, OCR en Vs worden hier niet afgeleid.',
  'params.whereUnitSits': 'Waar deze eenheid ligt',
  'params.fenceCutoutBlurb':
    'Het hekkendiagram teruggebracht tot de wanden van de geselecteerde eenheid over de basiskaart: een visueel ankerpunt, geen editor.',
  'params.loading3dView': '3D-weergave laden…',
  'params.kindGeotech': 'geotechnisch',
  'params.kindLitho': 'lithologisch',
  'params.noModelYet': 'Nog geen {kind} model. De hekkenuitsnede verschijnt zodra er een is.',
  'params.assemblingFence': 'Hekkendiagram samenstellen…',
  'params.noFenceWalls':
    'Nog geen hekkenwanden voor deze eenheid. Verbind haar banden over de profielen en ze verschijnen hier.',
  'params.zoomToUnit': 'Zoom naar eenheid',
  'params.zoomToUnitTitle': 'Vlieg de camera naar de wanden van de gekozen eenheid',
  'params.fenceBasemap': 'Achtergrondkaart',
  'params.resetCameraFrame': 'Zet de camera terug om het model te kaderen',
  'params.identificationTests': 'Identificatieproeven',
  'params.labTestsLoadFailedDetail': 'Kon de labproeven voor deze eenheid niet laden: {error}',
  'params.labTestsLoadFailed': 'Kon de labproeven voor deze eenheid niet laden.',
  'params.okpBlurb':
    'Classificatie-labresultaten (OKP) op de boringmonsters van de eenheid: waarde tegenover peil.',
  'params.samplesSkippedOne': ' {n} monster overgeslagen. Collarpeil onbekend.',
  'params.samplesSkippedMany': ' {n} monsters overgeslagen. Collarpeil onbekend.',
  'params.loadingIdentificationTests': 'Identificatieproeven laden…',
  'params.noIdentificationTests': 'Geen identificatieproeven in deze eenheid.',
  'params.sampleSuffix': ' · monster {n}',
  'params.idDotTooltip': '{value} {unit} · {elevation} mTAW · {borehole}{sample}',
  'params.idPanelAriaLabel': '{label}: {n} monsters tegenover peil',
  'params.grainSizeDistributions': 'Korrelverdelingen',
  // FLAG alt: (% doorval) — "% passing" in a PSD is "% doorval" / "% zeefdoorval".
  'params.percentPassingParen': '(% doorval)',
  // FLAG alt: kromme | krommen — PSD "curve" is often kept as "curve" in BE.
  'params.curveCountOne': '{n} curve',
  'params.curveCountMany': '{n} curves',
  'params.psdSkipped': '{n} overgeslagen (minder dan 2 zeefpunten)',
  'params.passingPct': 'Doorval (%)',
  'params.psdAriaLabel': 'Korrelverdelingen: {n} curves, % doorval tegenover diameter',
  'params.diameterMm': 'Diameter (mm)',
  'params.grainSizeCurveActions': 'Acties voor korrelverdelingscurve',
  'params.showSampleOnSection': 'Toon monster op dwarsprofiel',
  'params.loadingUnitRoster': 'Eenhedenlijst laden…',
  'params.noUnitsYet': 'Nog geen eenheden',
  'params.noUnitsHintTree':
    'Bouw een lithologisch model in de fase Lithologie en verdeel het daarna in de fase Geotechniek. De boom vult zich hier.',
  'params.bodyLabelLoading': 'Laden…',
  'params.unitsHeader': 'Eenheden',
  'params.orphanBandsOne': '{n} band buiten het lithomodel',
  'params.orphanBandsMany': '{n} banden buiten het lithomodel',
  'params.phase5NoteUnitList':
    'φ′ · c′ · cu · E50: ontwerpparameters verschijnen in fase 5, zodra de correlatie- en NAD-NEN-opzoekpijplijn landt.',
  'params.nodeBandsOne': '{n} band · {cone} met conus',
  'params.nodeBandsMany': '{n} banden · {cone} met conus',
  // Groeperen in het rechterpaneel (eigenaar 2026-09-03) — dezelfde
  // lichaam-samenvoeg-verb als op de doorsnede; een groep is een label over
  // losse lichamen, dus de ongedaan-maken-weg is Ontkoppelen.
  'params.groupNSelected': '{n} geselecteerd',
  'params.group': 'Groeperen',
  'params.ungroup': 'Ontkoppelen',
  'params.clearSelection': 'Wissen',
  'params.groupCheckboxAria': 'Selecteer {label} om te groeperen',
  'params.groupCheckboxAriaWithParent': 'Selecteer {label} ({parent}) om te groeperen',
  'params.checkedInside': '{n} aangevinkt hierin',
  'params.groupNeedTwoHint': 'Selecteer minstens twee lichamen om te groeperen.',
  'params.groupCrossClassHint': 'Alleen lichamen met dezelfde pakkingsklasse kunnen worden gegroepeerd.',
  'params.groupCrossClassHintNamed':
    'Alleen lichamen met dezelfde pakkingsklasse kunnen worden gegroepeerd. Je selecteerde {classes}.',
  'params.grouped': 'Gegroepeerd. Selecteer een lid en klik Ontkoppelen om ongedaan te maken.',
  'params.ungrouped': 'Ontkoppeld. Het lichaam staat weer los.',
  'params.groupFailed': 'Kon de lichamen niet groeperen.',
  'params.ungroupFailed': 'Kon het lichaam niet ontkoppelen.',
  'params.unitNoLongerExists': 'Deze eenheid bestaat niet meer',
  'params.unitNoLongerExistsHint':
    'Ze werd verwijderd of herbouwd sinds ze geselecteerd werd. Kies een andere eenheid in de lijst.',
  'params.lithostratigraphicUnit': 'Lithologische eenheid',
  'params.geotechnicalUnit': 'Geotechnische eenheid',
  // Blok karakteristieke waarden NAD (eigenaarsbeslissing 2026-09-05) — een
  // aflezing per body van de NAD-tabel, apart van de statistieken per eenheid.
  'params.nadValuesTitle': 'Karakteristieke waarden NAD',
  'params.nadProvenance':
    'NBN EN 1997-1 ANB Tabel 2.1, karakteristieke waarden voor klasse {n} ({name})',
  'params.nadCaveat': 'Karakteristieke waarden uit de NAD-tabel, geen ontwerpwaarden.',
  'params.nadDryUnitWeight': 'droog volumegewicht',
  'params.nadWetUnitWeight': 'nat volumegewicht',
  'params.nadFrictionAngle': 'wrijvingshoek',
  'params.nadCohesion': 'cohesie',
  'params.nadUndrainedShear': 'ongedraineerde schuifsterkte',
  'params.closeUnitStats': 'Sluit de eenheidsstatistieken',
  'params.loadingMeasurements': 'Metingen laden…',
  'params.populationNote':
    'n = {qcN} qc-monsters over {cptCount} {cptWord} op {sectionCount} {sectionWord}. Enkel proeven op profielen tellen mee; verborgen en weggehaalde zijn uitgesloten',
  'params.cptWordSingular': 'sondering',
  'params.cptWordPlural': 'sonderingen',
  'params.sectionWordSingular': 'dwarsprofiel',
  'params.sectionWordPlural': 'dwarsprofielen',
  'params.noTestsYet': 'Nog geen proeven',
  'params.noTestsHint':
    'Importeer sonderingen / boringen in de fase Data. Ze verschijnen hier zodra het project onderzoeken bevat.',
  'params.colKind': 'Soort',
  'params.colDepthM': 'Diepte (m)',
  'params.colIcBar': 'Ic̄ (Robertson 2015)',
  'params.testCountOne': '{n} proef',
  'params.testCountMany': '{n} proeven',
  'params.perTestFooterRest':
    ' · klik op een sondeerregel om de dieptereeks en het profiel van het grondgedragstype te tekenen in de inspector rechts. Ic̄ verschijnt zodra de reeks van die sondering geladen is.',
  'params.designReadyParam':
    'Ontwerpklare parameter: verschijnt in fase 5 zodra de correlatie- / xlsx-pijplijn landt.',
  'params.noUnitsHintStats':
    'Bouw een lithologisch model in de fase Lithologie en verdeel het daarna in de fase Geotechniek. De eenheden vullen zich hier met hun statistieken.',
  'params.pickUnit': 'Kies een eenheid',
  'params.pickUnitHint':
    'Klik op een eenheid in de lijst rechts. Haar qc / fs / Rf-statistieken tekenen hier. Rechtsklikken op een band in een dwarsprofiel springt hier ook naartoe.',
  'params.excelLookupsSubtitle':
    'Tabelgestuurde waarden uit door de eigenaar samengestelde of projectgeïmporteerde spreadsheets. Strikt gescheiden van correlaties: de ingenieur kiest ÉÉN pad per cel.',
  'params.methodRobertsonWride': 'Robertson & Wride 1986',
  'params.methodMayne': 'Mayne 2007',
  'params.methodKulhawyMayne': 'Kulhawy & Mayne 2014',
  'params.methodUzielli': 'Uzielli 2013',
  'params.methodRobertson2015': 'Robertson 2015 / 2009',
  'params.methodRefRobertsonWride': 'φ′ uit Qtn: Robertson, P.K. & Wride, C.E. (1998)',
  'params.methodRefMayne': 'φ′ uit Qtn: Mayne, P.W. (2007)',
  'params.methodRefKulhawyMayne': 'OCR uit Qt: Kulhawy & Mayne (2014)',
  'params.methodRefUzielli': 'φ′ probabilistisch: Uzielli (2013)',
  'params.methodRefRobertson2015': 'SBT-zone + Ic: Robertson (2015), zonekaart (2009)',
  'params.methodRefNadNen': 'Door eigenaar samengesteld; opzoeking per NAD-klasse × parameter',
  'params.methodRefXlsx': 'Door gebruiker aangeleverd; eenmaal per project geladen',
  'params.methodRefProbabilistic': 'Per parameter μ ± σ + verdelingstype (Normaal / Lognormaal / Bèta)',
  'params.methodRefMl': 'Nazicht verplicht (past nooit automatisch toe, richtlijn eigenaar)',
  'params.methodAppliesRobertsonWride': 'Zandeenheden (Ic < 2,6); invoer qc, fs',
  'params.methodAppliesMayne': 'Zandeenheden; invoer qc, σ′v',
  'params.methodAppliesKulhawyMayne': 'Kleieenheden (Ic > 2,6); invoer qc, σv, σ′v',
  'params.methodAppliesUzielli': 'Zandeenheden; levert μ + σ in plaats van een scalair',
  'params.methodAppliesRobertson2015': 'Alle eenheden; de segmenter gebruikt dit pad al (port voltooid)',
  'params.methodAppliesNadNen': 'Zand + fijne fractie NAD-klassen 1–31; primaire v1.0-opzoekbron',
  'params.methodAppliesXlsx': 'Overschrijft de NAD-NEN-standaarden wanneer de ingenieur zijn eigen tabel meelevert',
  'params.methodAppliesProbabilistic':
    'Probabilistisch ontwerp verderop (D-Stability Probabilistic Toolkit, Plaxis-statistiekenexport)',
  'params.methodAppliesMl':
    'Vergelijking naast elkaar met de correlatie- / xlsx-keuze; gemarkeerd wanneer de voorspelling afwijkt',
  'params.phase5Placeholder': 'Placeholder fase 5',
  'params.methodsStatusPre': 'Status: alle kaarten hierboven zijn ',
  'params.methodsStatusBold': 'structurele skeletten',
  'params.methodsStatusPost':
    ' voor fase 5. Door de drie-pijlerarchitectuur nu te tonen blijven de ontwerpbeslissingen zichtbaar. Geef weerwerk op de vorm (welke methodes, welke xlsx-bronnen, de regel van strikte scheiding) VOORDAT het implementatiebudget voor fase 5 vastligt.',

  // -------------------------------------------------------------------------
  // export
  // -------------------------------------------------------------------------
  'export.title': 'Exports',
  'export.blurb': 'Geef het grondmodel door aan een ontwerptool verderop in de keten.',
  'export.sections': 'Profielen',
  'export.geology': 'Stratigrafie',
  'export.crossSection': 'Dwarsprofiel',
  'export.crossSectionToExport': 'Te exporteren dwarsprofiel',
  'export.sectionBlurb':
    'Exporteer de laaggeometrie van één dwarsprofiel: DXF (universele CAD-uitwisseling) of een uitvoerbaar Plaxis 2D plxscripting-script met één boring per geprojecteerde kolom.',
  'export.geologyPlaxis3d': 'Stratigrafisch model → Plaxis 3D',
  'export.geologyBlurb':
    'Exporteer het volledige model als een uitvoerbaar plxscripting Python-script: één voorlopige Mohr-Coulomb-grondsoort en één boring per grondonderzoek.',
  'export.noActiveModel':
    'Geen actief stratigrafisch model. Leg eerst formaties vast en plaats laaggrenzen.',
  'export.dxf': 'AutoCAD DXF',
  'export.pythonScript': 'Python-script',
  'export.allFiles': 'Alle bestanden',
  'export.gefFiles': 'GEF-bestanden',
  'export.dStability': 'D-Stability (.stix)',
  'export.dSheetPiling': 'D-Sheet Piling (.shi)',
  'export.dxfFailed': 'Kon de DXF niet exporteren.',
  'export.pdfFailed': 'Kon de PDF niet exporteren.',
  'export.plaxisFailed': 'Kon het Plaxis-script niet exporteren.',
  'export.fenceFailed': 'Kon het hekkendiagram niet exporteren.',
  'export.reportEngineer': 'Naam van de ingenieur',
  'export.reportGenerate': 'PDF van het profiel genereren',
  'export.reportNotes':
    'Optionele vrije tekst die onder de tabel met projectgegevens getoond wordt.',
  'export.reportBlurb':
    'Pas de titel en gegevens aan die in de hoofding van het rapport verschijnen. Alle velden zijn optioneel. Laat de standaardtitel staan voor de profielnaam.',
  'export.reportTitleLabel': 'Titel',
  'export.reportAuthorLabel': 'Auteur',
  'export.reportNotesLabel': 'Notities',
  'export.reportGenerating': 'Genereren…',
  'export.reportGeneratePdf': 'PDF genereren',

  // --- export stage canvas + fence DXF + shared 3D view (P6 coverage) ---
  'export.heading': 'Export',
  'export.canvasBlurb':
    'Geef het grondmodel door aan een ontwerptool verderop in de keten. De laaggeometrie is de integratie-eenheid: parameters per laag worden in de doeltool ingesteld.',
  'export.guidanceNoModelPre':
    'Geen actief stratigrafisch model. Leg formaties vast en plaats laaggrenzen in de fase ',
  'export.guidanceNoModelPost': '.',
  'export.guidanceNoSectionsPre': 'Nog geen dwarsprofielen. Maak er een in de fase ',
  'export.guidanceNoSectionsPost': '.',
  'export.exporting': 'Exporteren…',
  'export.exportDxf': 'DXF exporteren',
  'export.exportPlaxis2d': 'Plaxis 2D exporteren',
  'export.exportPlaxis3d': 'Plaxis 3D exporteren',
  // FLAG alt: Hekwerk — fence-view mode; the diagram noun stays "hekkendiagram".
  'export.fenceNothingToExport':
    'Niets te exporteren: zet de 3D-weergave op Hekwerk en zorg dat het hekwerk wanden heeft.',
  'export.fenceExported': 'Hekkendiagram geëxporteerd: {count} panelen.',
  'export.fenceIncompleteOne':
    '{n} dwarsprofiel kon zijn correlaties niet laden. Het hekwerk is onvolledig en toont die panelen ongekoppeld: {names}. Heropen de Hekwerk-weergave om opnieuw te proberen.',
  'export.fenceIncompleteMany':
    '{n} dwarsprofielen konden hun correlaties niet laden. Het hekwerk is onvolledig en toont die panelen ongekoppeld: {names}. Heropen de Hekwerk-weergave om opnieuw te proberen.',
  'export.viewLabel': 'Weergave',
  'export.viewSolid': 'Massief',
  // FLAG alt: Waaier | Hekkendiagram — 3D fence view mode.
  'export.viewFence': 'Hekwerk',
  'export.viewWireframe': 'Draadmodel',
  'export.viewWireframeTitle': 'Toon het lichaammodel als draadmodel',

  // --- Export-hub (installer #35, de Export-stap is de enige exportplek) ---
  'export.hubBlurb':
    'Alle exports staan hier. Kies een dwarsprofiel en exporteer het naar de tool die je nodig hebt. Hekkendiagrammen en het 3D-model exporteer je via hun eigen kaarten hieronder.',
  'export.crossSectionPickerLabel': 'Te exporteren dwarsprofiel',
  'export.axisLabel': 'Modelniveau',
  'export.axisGeological': 'Stratigrafie',
  'export.axisLithological': 'Lithologie',
  'export.axisGeotechnical': 'Geotechniek',
  'export.groupCrossSection': 'Dwarsprofiel',
  'export.groupStratigraphy': 'Stratigrafie',
  'export.groupLithology': 'Lithologie',
  'export.groupGeotechnical': 'Geotechniek',
  'export.groupReport': 'Rapport',
  'export.cardSectionDxfTitle': 'Dwarsprofiel-DXF',
  'export.cardSectionDxfDesc':
    'De laaggeometrie van één dwarsprofiel als AutoCAD-DXF, op het gekozen modelniveau.',
  'export.cardPlaxis3dTitle': 'Stratigrafisch model → Plaxis 3D',
  'export.cardPlaxis3dDesc':
    'Het volledige model als uitvoerbaar plxscripting-script: één voorlopige grondsoort en één boring per grondonderzoek.',
  'export.cardLithoFenceTitle': 'Hekkendiagram (DXF)',
  'export.cardLithoFenceDesc':
    'De lithologische 3D-hekwanden als DXF: één laag per profiel per eenheid.',
  'export.cardGeotechDstabilityDesc':
    'Het geotechnische dwarsprofiel als gesloten D-Stability-polygonen (alleen geometrie, geen ontwerpparameters).',
  'export.cardGeotechDsheetDesc':
    'Een 1D-grondprofiel doorheen het geotechnische dwarsprofiel als D-Sheet .shi (alleen geometrie).',
  'export.cardGeotechPlaxis2dTitle': 'Plaxis 2D (pakkingsklassen)',
  'export.cardGeotechPlaxis2dDesc':
    'Het geotechnische dwarsprofiel, met NAD-pakkingsklassen, als Plaxis 2D-script.',
  'export.cardGeotechFenceTitle': 'Hekkendiagram (DXF)',
  'export.cardGeotechFenceDesc':
    'De geotechnische 3D-hekwanden als DXF, gekleurd volgens NAD-pakkingsklasse.',
  'export.cardPdfTitle': 'PDF-rapportblad',
  'export.cardPdfDesc': 'Een A3-tekenblad van het dwarsprofiel: bekijk het en print naar PDF.',
  'export.exportFence': 'Hekwerk exporteren',
  'export.exportStix': '.stix exporteren',
  'export.exportShi': '.shi exporteren',
  'export.openPreview': 'Voorbeeld openen',
  'export.lastSaved': 'Laatst opgeslagen: {path}',
  'export.guideNoStratModel':
    'Nog geen stratigrafisch model: leg eerst formaties en laaggrenzen vast in de Stratigrafie-stap.',
  'export.guideNoLithoModel':
    'Nog geen lithologisch model: maak en bouw er eerst een in de Lithologie-stap.',
  'export.guideNoGeotechModel':
    'Nog geen geotechnisch model: onderverdeel eerst de lithologische eenheden in de Geotechniek-stap.',
  'export.guideNoSections': 'Nog geen dwarsprofielen: teken er eerst een in de Profielen-stap.',
  'export.guidePickSection': 'Kies hierboven een dwarsprofiel om te exporteren.',
} as const
