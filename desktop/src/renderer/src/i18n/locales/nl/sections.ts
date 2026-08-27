// Profielstap — het profielcanvas, de werkbalk, het detailvenster, de
// profielkop, de contextmenu's en de aanwijzingen op de overlays.
//
// Part of the Dutch (BE) message catalogue — see 'locales/nl/index.ts'.

export const SECTIONS_NL = {
  'sections.title': 'Dwarsprofielen',
  'sections.new': 'Nieuw dwarsprofiel',
  'sections.newPlus': '+ Nieuw dwarsprofiel',
  'sections.none': 'Nog geen dwarsprofielen',
  'sections.emptyBlurb':
    'Teken een lijn op de kaart om een profiel vast te leggen, of maak er een aan met voorlopige eindpunten.',
  'sections.delete': 'Dwarsprofiel verwijderen…',
  'sections.deleteConfirm': 'Dwarsprofiel verwijderen?',
  'sections.rename': 'Klik om dit dwarsprofiel te hernoemen',
  'sections.name': 'Profielnaam',
  'sections.properties': 'Eigenschappen van het profiel',
  'sections.modelActions': 'Modelacties',
  // FLAG alt: Weergaveniveau | Modelniveau — the app switches the section
  // between the geology / litho / geotech levels; "as" is the internal metaphor
  // and reads oddly to a first-time user.
  'sections.modelAxis': 'Modelas',
  'sections.buffer': 'Projectiebuffer',
  'sections.bufferLabel': 'Projectiebuffer (m)',
  'sections.bufferLateral': 'Laterale projectiebuffer',
  'sections.bufferHint':
    'Loodrechte afstand tot de profiellijn waarbinnen grondonderzoek geprojecteerd wordt',
  'sections.vex': 'Verticale overdrijving',
  'sections.vexShort': 'V-overdr.',
  'sections.vexHint':
    'Verticale overdrijving van de profielweergave (1 = geen overdrijving, 10 = 10× uitgerekt)',
  'sections.columnSpacing': 'Kolomafstand',
  'sections.columnSpacingHint':
    'Afstand tussen de proeven — bij 0% staan de proeven op hun werkelijke geprojecteerde X (banden kunnen overlappen)',
  'sections.referenceGeologicalModel': 'Referentie-geologisch model',
  'sections.geologyBackdrop': 'Geologische achtergrond (litho-as)',
  'sections.geologyBackdropHint':
    'Wordt als vage referentielaag getoond wanneer de litho-as actief is.',
  'sections.syncGeology': 'Geologie synchroniseren',
  'sections.boreholePreview': 'Voorbeeld boringen',
  'sections.virtueleBoringOverlay': 'Overlay Virtuele Boring',
  'sections.closeView': 'Profielweergave sluiten',
  'sections.closeViewHint': 'Profielweergave sluiten (terug naar de kaart)',
  'sections.resetFraming': 'Weergave terugzetten naar de standaarduitsnede',
  'sections.exitFocus': 'Focusmodus verlaten',
  'sections.exitFocusHint': 'Focusmodus verlaten (Esc)',
  'sections.noFormationContacts': 'Geen formatiegrenzen op dit profiel',
  'sections.restoreHidden':
    'Herstel elke proef die op dit profiel verborgen is. Hun kolommen verschijnen bij de volgende weergave opnieuw.',
  'sections.sizingCanvas': 'Canvas wordt ingemeten…',
  'sections.findColumn': 'Kolom zoeken',
  'sections.findColumnPlaceholder': 'Kolom zoeken… (bv. S8)',
  'sections.closeFind': 'Zoeken sluiten',
  'sections.columnName': 'Kolomnaam',
  'sections.zoomInHint': 'Inzoomen (of scroll op het canvas)',
  'sections.zoomOutHint': 'Uitzoomen (of scroll op het canvas)',

  // ---------------------------------------------------------------------------
  // werkbalk
  // ---------------------------------------------------------------------------
  'sections.toolbar.display': 'Weergave',
  // FLAG alt: Bodies | Eenheden — the section toolbar's group of body verbs.
  'sections.toolbar.bodies': 'Lichamen',
  'sections.toolbar.geology': 'Geologie',
  'sections.toolbar.export': 'Export',
  'sections.toolbar.undo': 'Ongedaan maken',
  'sections.toolbar.undoHint': 'Maak de laatste modelbewerking ongedaan',
  'sections.toolbar.clear': 'Wissen',
  'sections.toolbar.clearBulk': 'Bulk wissen',
  'sections.toolbar.correlateContacts': 'Laaggrenzen correleren',
  'sections.toolbar.uncorrelateContacts': 'Correlatie opheffen',
  'sections.toolbar.acceptAllSuggestions': 'Alle voorstellen aanvaarden',
  'sections.toolbar.acceptAllBulkSuggestions': 'Alle bulkvoorstellen aanvaarden',
  'sections.toolbar.clearLithoSuggestions': 'Lithovoorstellen wissen',
  'sections.toolbar.clearCorrelationSuggestions': 'Correlatievoorstellen wissen',
  // NOTE: ruled 2026-08-27 — owner chose "Ghost-overlays wissen".
  'sections.toolbar.clearBulkGhosts': 'Ghost-overlays wissen',
  'sections.toolbar.dismissLithoGhost': 'De huidige litho-ghost-overlay sluiten',
  'sections.toolbar.dismissBulkGhosts':
    'De ghost-overlays van de bulkactie voor elk grondonderzoek sluiten',
  'sections.toolbar.suggestAllTests': 'Lithologie voorstellen voor alle proeven?',
  'sections.toolbar.recomputeBodies': 'Lichamen herberekenen',
  'sections.toolbar.resetPoints': 'Punten herstellen',
  'sections.toolbar.resetPointsConfirm': 'Alle handmatige punten herstellen?',
  'sections.toolbar.resetPointsBody':
    'Elk handgetekend grenspunt in dit model wordt gewist en de lichamen worden opnieuw opgebouwd op basis van de correlaties alleen.',
  'sections.toolbar.admixtures': 'Bijmengingen',
  'sections.toolbar.reseedAdmixtures': 'Bijmengingen uit de boringen opnieuw inlezen',
  'sections.toolbar.stripAdmixtures': 'Alle bijmengingen verwijderen',
  'sections.toolbar.clearGhostAdmixtures': 'Bijmengingen uit elk voorstel wissen',
  'sections.toolbar.editGeologyContacts':
    'De laaggrenzen van het geologisch model op dit profiel bewerken',
  'sections.toolbar.noLithoModel':
    'Geen lithostratigrafisch model — maak er een aan in de lithologiestap.',
  'sections.toolbar.showLayers': 'Toon of verberg lagen van de profielweergave',
  'sections.toolbar.applyNextSubdivide':
    'Geldt vanaf de volgende keer Onderverdelen — er wordt nu niets opnieuw berekend',
  'sections.toolbar.statisticFailed': 'Kon de statistiek niet instellen.',
  'sections.toolbar.noPackingBands':
    'Nog geen pakkingsbanden op dit profiel — gebruik eerst "1 · Sonderingen onderverdelen" op dit profiel',
  'sections.toolbar.packingFlowHint':
    'De pakkingsstroom in vier stappen: 1 de sonderingen onderverdelen, 2 koppelingen voorstellen, 3 ze nakijken en aanvaarden, 4 de boringen verdelen. Alle vier werken ze op het profiel dat je open hebt en laten ze elk ander profiel ongemoeid, zodat je één dwarsprofiel kan afwerken terwijl het volgende nog voorstellen open heeft staan. Stap 4 blijft vergrendeld tot alle koppelingen van dit profiel aanvaard of verwijderd zijn.',
  'sections.toolbar.previewDivideHint':
    'Bekijk de pakkingsbanden die "4 · Boringen verdelen" zou vastleggen, gearceerd over de boorkolommen. Er wordt niets weggeschreven.',
  'sections.toolbar.lithoFillHint':
    'Kleur de gesloten contour van elk lichaam met zijn lithologie, over het hele profiel. Doe dit zodra de correlaties en uitwiggingen klaar zijn. Aan / uit.',
  'sections.toolbar.correlationRibbonsHint':
    'Toon of verberg de correlatielinten en -lijnen over het profiel. Enkel een 2D-visualisatie van je correlaties — er is geen verband met het 3D-model. Aan / uit.',
  'sections.toolbar.solidFillHint':
    'Toon of verberg de profielvulling die uit de opgebouwde 3D-lichamen bemonsterd is. Aan / uit.',
  'sections.toolbar.geotechSolidFillHint':
    'Toon of verberg de vulling die uit de OPGEBOUWDE geotechnische 3D-lichamen gesneden is — het model zoals bij de laatste opbouw, niet de actuele banden. Er wordt telkens één vulling getekend.',
  'sections.toolbar.packingFillHint':
    'Toon of verberg de vulling met NAD-pakkingsbanden — de ACTUELE pakkingsklassen, zoals de reeks ze het laatst weggeschreven heeft. Er wordt telkens één vulling getekend.',
  'sections.toolbar.swapFillHint':
    'Wissel de lithostratigrafische vulling in voor de NAD-pakkingsvulling — er wordt telkens één vulling getekend, nooit beide.',
  'sections.toolbar.qcStatisticHint':
    'Welke representatieve qc de NAD-classificatie leest, te kiezen VOOR je de pakkingsbanden eronder opbouwt. De keuze geldt voor de VOLGENDE "1 · Sonderingen onderverdelen"; banden die al op het scherm staan behouden de statistiek waarmee ze opgebouwd zijn tot je ze opnieuw uitvoert.',
  'sections.toolbar.sampleMarkersHint':
    'Toon of verberg de monstermarkeringen op de boorkolommen. Elke markering beslaat het diepte-interval waarover het monster genomen is.',
  'sections.toolbar.psdCardHint':
    'Toon een kaartje met de korrelverdeling terwijl je over een monstermarkering zweeft. Druk op P om dit om te zetten zonder dit menu te openen.',

  // ---------------------------------------------------------------------------
  // profielkop
  // ---------------------------------------------------------------------------
  'sections.header.cptChannels': 'Schakelaars voor de sondeerkanalen',
  'sections.header.qc': 'Conusweerstand (qc)',
  // NOTE: ruled 2026-08-27 — owner chose "Plaatselijke wrijvingsweerstand (fs)".
  'sections.header.fs': 'Plaatselijke wrijvingsweerstand (fs) — enkel CPTU/CPTE',
  'sections.header.rf': 'Wrijvingsgetal (Rf)',
  'sections.header.u2': 'Waterspanning (u2) — enkel CPTU',
  'sections.header.qTotal': 'Totale weerstand (qTotal) — enkel CPTM',
  'sections.header.streamToggles':
    'Schakelaars voor de interpretatiestromen van de boring — elke ingeschakelde stroom krijgt zijn eigen strook naast de andere',
  'sections.header.formalStratigraphy': 'Formele stratigrafie',
  'sections.header.formalStratigraphyShort': 'F-Strat',
  'sections.header.informalStratigraphy': 'Informele stratigrafie',
  'sections.header.informalStratigraphyShort': 'I-Strat',
  'sections.header.geotechnicalCoding': 'Geotechnische codering',
  'sections.header.geotechnicalCodingShort': 'Geo',

  // ---------------------------------------------------------------------------
  // aanwijzingen op het canvas
  // ---------------------------------------------------------------------------
  'sections.hints.f1': 'Druk op F1 voor het volledige overzicht van de gebaren',
  'sections.hints.lithoLayer':
    'Litholaag: dubbelklik om te aanvaarden · Alt+slepen om de samenstelling te kopiëren · Shift+slepen voorbij het midden van de buur om ze op te nemen · rechtsklik voor meer',
  'sections.hints.acceptFirst':
    'Aanvaard lithovoorstellen om te kunnen correleren — 0 aanvaarde laaggrenzen op dit profiel.',
  'sections.hints.buildGeotechFirst':
    'Bouw het geotechnisch model voor dit profiel op voor je een NAD-onderverdeling voorstelt.',

  // ---------------------------------------------------------------------------
  // contextmenu's
  // ---------------------------------------------------------------------------
  'sections.menu.body': 'Acties op de lichaamsuitbreiding',
  // NOTE: ruled 2026-08-27 — owner chose "Lichaam ontbinden".
  'sections.menu.dissolveBody': 'Lichaam ontbinden',
  'sections.menu.nameBody': 'Lichaam benoemen…',
  // FLAG alt: Focus op dit onderzoekspunt | Focus op deze kolom — "test" here
  // means one CPT or borehole column on the section.
  'sections.menu.focusTest': 'Focus op deze proef',
  'sections.menu.openDetail': 'Details openen',
  'sections.menu.removeFromSection': 'Uit dit profiel weghalen',
  'sections.menu.clearSubdivision': 'Onderverdeling wissen',
  'sections.menu.deleteContact': 'Laaggrens verwijderen',
  'sections.menu.linkToGeology': 'Koppelen aan de geologie',
  'sections.menu.unlinkFromGeology': 'Loskoppelen van de geologie',
  'sections.menu.editInGeology': 'Bewerken in de geologiestap',
  'sections.menu.mergeLayers': 'Lagen samenvoegen',
  'sections.menu.removeLithoUnit': 'Deze litho-eenheid weghalen',
  'sections.menu.addSuggestionHere': 'Hier een nieuw voorstel toevoegen',
  'sections.menu.insertLayerHere': 'Hier een laag invoegen…',
  'sections.menu.editComposition': 'Samenstelling bewerken…',
  'sections.menu.splitLayer': 'Laag splitsen',
  'sections.menu.acceptLayer': 'Laag aanvaarden',
  'sections.menu.rejectLayer': 'Laag verwerpen',
  'sections.menu.extendToNearest': 'Doortrekken tot de dichtstbijzijnde laaggrenzen',
  'sections.menu.ghostActions': 'Acties op de voorgestelde laag',
  'sections.menu.boundaryActions': 'Acties op de grens',
  // FLAG alt: Verbinding bevestigen | Tie bevestigen — a "tie" is an accepted
  // correlation between two columns. "Koppeling" is the natural NL word. This
  // term recurs ~15 times, so the ruling propagates widely.
  'sections.menu.confirmTie': 'Koppeling bevestigen',
  'sections.menu.deleteCorrelation': 'Correlatie verwijderen',
  'sections.menu.inspectLensBody': 'Lenslichaam inspecteren…',
  'sections.menu.editBodyAdmixtures': 'Bijmengingen van dit lichaam bewerken',
  'sections.menu.mergeBands': 'Banden samenvoegen',
  'sections.menu.mergeIntoSurrounding': 'Opnemen in de omliggende band',
  'sections.menu.splitBand': 'Band splitsen…',

  // ---------------------------------------------------------------------------
  // laaggrenzen
  // ---------------------------------------------------------------------------
  'sections.contacts.insertHint':
    'Klik om hier een nieuwe laag in te voegen · rechtsklik om te verwijderen',
  'sections.contacts.lithoContactHint':
    'Lithostratigrafische laaggrens — slepen verplaatst het lithomodel mee',
  'sections.contacts.coupledHint':
    'Gekoppeld aan een geologische laaggrens — rechtsklik om los te koppelen',
  'sections.contacts.absorbHint':
    'Laat hier los en de band eronder wordt in deze eenheid opgenomen. Eén grens per sleepbeweging — sleep opnieuw voor de volgende.',
  'sections.contacts.absorbBlockedHint':
    'Stopt net voor de volgende lithostratigrafische laaggrens — verder gaan zou de eenheid eronder verwijderen. Verdeel die eerst onder, of bewerk ze op de litho-as.',
  'sections.contacts.deleteConfirm':
    'Deze laaggrens verwijderen? Dit verwijdert de grens en elke correlatie die eraan raakt.',
  'sections.contacts.deleteLensConfirm':
    'Deze lens verwijderen? Dit verwijdert de twee correlaties die de lens bepalen.',
  'sections.contacts.copyFailed':
    'Kon geen enkele laaggrens naar het doel kopiëren — zie de console voor details.',

  // ---------------------------------------------------------------------------
  // pakkingsbanden
  // ---------------------------------------------------------------------------
  // FLAG alt: band | zone — a "packing band" is a depth interval of one NAD
  // packing class inside a body. "Band" is short and already visual.
  'sections.bands.rightClickBoundary':
    'Rechtsklik om een nieuwe pakkingsgrens te plaatsen of deze band te verwijderen',
  'sections.bands.rightClickClass': 'Rechtsklik om de NAD-klasse van deze band handmatig te zetten',
  'sections.bands.nothingToSnap':
    'Niets om op vast te klikken in deze kolom — een boring bevat geen conusweerstand, dus er zijn hier geen pakkingsgrenzen.',
  'sections.bands.acceptGhosts': 'Deze banden aanvaarden (deze boring verdelen)',
  'sections.bands.pressDivide': 'Gebruik "Boringen verdelen" om vast te leggen.',
  'sections.bands.setPackingClass': 'Pakkingsklasse instellen',
  'sections.bands.movePackingBoundary': 'Pakkingsgrens verplaatsen',
  'sections.bands.splitPackingBand': 'Pakkingsband splitsen',
  'sections.bands.mergePackingBands': 'Pakkingsbanden samenvoegen',
  'sections.bands.absorbPackingLens': 'Pakkingslens absorberen',
  'sections.bands.disconnectPackingBands': 'Pakkingsbanden loskoppelen',

  // ---------------------------------------------------------------------------
  // lenzen
  // ---------------------------------------------------------------------------
  'sections.lens.candidate':
    'Mogelijke lens — geen correlatie met een van beide buren. Wig ze uit om ze als lens vast te leggen.',
  // FLAG alt: uitpenen | wigt uit — "uitwiggen" is the standard NL geological
  // verb and matches the owner's own "wigging out"; the flag is on the NOUN
  // form ("uitwigging") reading heavier than the verb.
  'sections.lens.pinchOutCandidate':
    'Mogelijke uitwigging — deze laag wigt uit naar de buur toe',
  'sections.lens.name': 'Naam van de lens',
  'sections.lens.namePlaceholder': 'bv. Boom Klei lens #1',
  'sections.lens.nameDialogTitle': 'Lens benoemen',
  'sections.lens.saveName': 'Naam opslaan',
  'sections.lens.namedKeptHint':
    'Een benoemde lens blijft bewaard: ze overleeft "Alle gedetecteerde lenzen verwijderen" en de volgende herberekening van de lichamen.',
  'sections.lens.boundaryStyle': 'Stijl van de grens',
  'sections.lens.boundaryStyleHint':
    'Hoe de lensgrens tussen de controlepunten getekend wordt.',
  'sections.lens.presentAt': 'Aanwezig bij',
  'sections.lens.absentAt': 'Afwezig bij',
  'sections.lens.noAbsenceRecords': 'Geen registraties van afwezigheid.',
  'sections.lens.promoteToManual':
    'Van afgeleid naar handmatig tillen — de afleidingsengine overschrijft deze regel niet meer',
  'sections.lens.companionTitle': 'Loodrecht dwarsprofiel aanmaken?',
  'sections.lens.companionBlurb':
    'Een loodrecht dwarsprofiel door het zwaartepunt van de lens helpt nagaan of de lens werkelijk in beide richtingen uitwigt.',
  'sections.lens.companionSkip': 'Nee, overslaan',
  'sections.lens.perpendicularSection': 'Loodrecht profiel…',

  // ---------------------------------------------------------------------------
  // koppelingen + aandachtspunten
  // ---------------------------------------------------------------------------
  'sections.tie.accept': 'Koppeling aanvaarden',
  'sections.tie.reject': 'Koppeling verwerpen',
  'sections.tie.proposed': 'Voorgesteld koppelprofiel — rechtsklik om te aanvaarden of te verwerpen',
  'sections.tie.keepFlagged': 'Gemarkeerd laten',
  'sections.tie.flaggedBlurb':
    'Verwijderen is één stap op de ongedaan-maken-stapel. Zolang een afwijkende koppeling op nazicht wacht, wordt ze met een waarschuwingsteken getekend.',
  'sections.reviewFlag.correlateOneBand': 'Correleren → één band',
  'sections.reviewFlag.uncorrelatedClay': 'Niet-gecorreleerde klei',

  // ---------------------------------------------------------------------------
  // overlays
  // ---------------------------------------------------------------------------
  'sections.dem.groundSurface': 'Maaiveld (DHMVII DTM)',
  'sections.vb.title': 'DOV virtuele boring',
  'sections.vb.toggleHint': 'Toon / verberg de bediening van de DOV Virtuele Boring-overlay',
  'sections.vb.loadingCatalogue': 'Catalogus laden…',
  'sections.vb.depthBelowSurface': 'm onder maaiveld',
  'sections.vb.full': 'Volledig',
  'sections.vb.off': 'Uit',
  'sections.psd.noGrainSize': 'Geen korrelverdeling',
  'sections.psd.finerByWeight': '% doorval in gewicht',
  'sections.psd.highlightBody': 'Klik om het pakkingslichaam te markeren',
} as const
