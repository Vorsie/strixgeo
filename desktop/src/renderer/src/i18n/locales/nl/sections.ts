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
  'sections.moreActions': 'Meer profielacties',
  'sections.geoVerbHint':
    'Schakel naar de geologie-as — Bouwen / Zaaien / Ontdubbelen / Plaxis-3D werken op het geologisch model',
  'sections.undoTitle': 'Maak de laatste modelbewerking ongedaan (Ctrl+Z)',
  'sections.undoNothing': 'Niets om ongedaan te maken',
  'sections.recomputeUnavailable': 'Lichamen herberekenen is niet beschikbaar — heropen het project.',
  'sections.reset.done':
    '{count} handgetekende {noun} hersteld — de lichamen zijn teruggezet naar hun berekende vorm.',
  'sections.reset.boundaryOne': 'grens',
  'sections.reset.boundaryMany': 'grenzen',
  'sections.reset.none': 'Geen handgetekende grenzen om te herstellen.',
  'sections.reset.failed': 'Handmatige punten herstellen mislukt — zie de console.',

  // ---------------------------------------------------------------------------
  // werkbalk-dialoogvensters
  // ---------------------------------------------------------------------------
  'sections.dialog.thisSection': 'Dit profiel',
  'sections.dialog.deleteBody':
    'wordt permanent verwijderd. Formatiegrenzen die erop geplaatst zijn, worden ook verwijderd. Dit kan niet ongedaan gemaakt worden.',
  'sections.dialog.deleteConfirmButton': 'Dwarsprofiel verwijderen',
  'sections.dialog.bulkPrefix': 'De lithologiesegmenteerder wordt uitgevoerd voor',
  'sections.dialog.bulkSuffix':
    'op dit profiel. Bestaande bulk-voorstel-ghosts worden vervangen. Al vastgelegde laaggrenzen op het profiel blijven ongemoeid.',
  'sections.dialog.noInvestigations': 'Geen grondonderzoeken',
  'sections.dialog.resetBody':
    'Elk handgetekend grenspunt in dit model wordt gewist en de lichamen keren terug naar hun berekende vorm. Dit kan niet ongedaan gemaakt worden.',

  // ---------------------------------------------------------------------------
  // profieldetailvenster (rechterpaneel)
  // ---------------------------------------------------------------------------
  'sections.inspector.noCrossSectionForContact':
    'Geen enkel dwarsprofiel bevat de betreffende laaggrens — teken er een door de boring of sondering om ze te bekijken.',
  'sections.inspector.staleBadge': '{n} verouderd',
  'sections.inspector.geologicalModel': 'Geologisch model',
  'sections.inspector.previewLegend':
    'Gearceerde banden = voorbeeld. Rechtsklik een ghost-kolom om enkel die boring te verdelen, of druk op “4 · Boringen verdelen” om ze allemaal vast te leggen.',
  'sections.inspector.previewClampedOne':
    '{n} geplande band buiten het dieptevenster — zoom uit om ze te zien.',
  'sections.inspector.previewClampedMany':
    '{n} geplande banden buiten het dieptevenster — zoom uit om ze te zien.',
  'sections.inspector.backdropClickPrefix': 'Klik op',
  'sections.inspector.backdropClickSuffix': 'in Modelacties om te laden.',
  'sections.inspector.setCrsFirst':
    'Stel eerst een standaard horizontaal CRS in bij de projectmetadata',
  'sections.inspector.createSection': 'Een nieuw dwarsprofiel aanmaken',
  'sections.inspector.setCrsToCreate': 'Stel een CRS in om profielen aan te maken',
  'sections.inspector.dirtyCreated':
    'Aangemaakt sinds de laatste bewaring — Bestand → Opslaan om vast te leggen',
  'sections.inspector.validationFailedLabel': 'Oppervlakvalidatie mislukt',
  'sections.inspector.validationFailedBody':
    'Oppervlakkruisingen konden NIET gecontroleerd worden — dit is geen zuiver resultaat. Herbouw of heropen het project om opnieuw te controleren.',
  'sections.inspector.validationPendingLabel': 'Oppervlakvalidatie in afwachting',
  'sections.inspector.validationPendingBody':
    'Oppervlakkruisingen niet gecontroleerd — bouw het 3D-model om te valideren.',
  'sections.inspector.crossingWarningsLabel': 'Waarschuwingen oppervlakkruisingen',
  'sections.inspector.crossingsDetectedOne': '{n} oppervlakkruising gedetecteerd',
  'sections.inspector.crossingsDetectedMany': '{n} oppervlakkruisingen gedetecteerd',
  'sections.inspector.openOffendingSection':
    'Open het dwarsprofiel met de betreffende laaggrenzen en pan ernaartoe.',
  'sections.inspector.geoAxisHintBuildDedupe':
    'Schakel naar de geologie-as — Bouwen / Ontdubbelen werken op het geologisch model',
  'sections.inspector.buildNoModel':
    'Geen actief geologisch model — maak eerst formaties en laaggrenzen aan',
  'sections.inspector.buildingSurfaces': 'Oppervlakken bouwen…',
  'sections.inspector.surfacesNeedRebuildOne':
    '{n} formatie-oppervlak moet herbouwd worden — klik om TIN’s te berekenen',
  'sections.inspector.surfacesNeedRebuildMany':
    '{n} formatie-oppervlakken moeten herbouwd worden — klik om TIN’s te berekenen',
  'sections.inspector.rebuildTins':
    'Herbouw TIN-oppervlakken op basis van de huidige laaggrenzen',
  'sections.inspector.building': 'Bouwen…',
  'sections.inspector.buildStale': 'Bouwen · {n} verouderd',
  'sections.inspector.buildModel': 'Model bouwen',
  'sections.inspector.noParentGeoModel': 'Geen bovenliggend geologisch model gekoppeld',
  'sections.inspector.loadingGeoSurfaces': 'Geologische oppervlakken laden…',
  'sections.inspector.syncGeologyTitle':
    'Laad de oppervlakken van het bovenliggende geologische model als een alleen-lezen achtergrondreferentie op dit profiel',
  'sections.inspector.syncing': 'Synchroniseren…',
  'sections.inspector.syncGeology': 'Geologie synchroniseren',
  'sections.inspector.seedDefineFirst':
    'Definieer eerst formaties in de geologiestap — Zaaien plaatst laaggrenzen voor reeds gedefinieerde lagen',
  'sections.inspector.seedingContacts': 'Laaggrenzen zaaien uit de boorstratigrafie…',
  'sections.inspector.seedTitle':
    'Plaats laaggrenzen uit boorwaarnemingen voor formaties die al in het model gedefinieerd zijn — voer Ontdubbelen uit als er dubbels verschijnen',
  'sections.inspector.seeding': 'Zaaien…',
  'sections.inspector.seed': 'Zaaien',
  'sections.inspector.seedDefineFirstShort': 'Definieer eerst formaties in de geologiestap',
  'sections.inspector.allHaveGeologyContacts':
    'Alle boringen in bereik hebben al geologische laaggrenzen — importeer nieuwe proeven om dit te gebruiken',
  'sections.inspector.seedNewTestsTitleOne':
    'Plaats laaggrenzen uit de stratigrafie voor de {n} boring zonder geologische laaggrenzen',
  'sections.inspector.seedNewTestsTitleMany':
    'Plaats laaggrenzen uit de stratigrafie voor de {n} boringen zonder geologische laaggrenzen',
  'sections.inspector.seedForNewTests': 'Zaaien voor nieuwe proeven',
  'sections.inspector.cleaning': 'Opschonen…',
  'sections.inspector.dedupeTitle':
    'Verwijder dubbele (anker, formatie) laaggrenzen — behoudt de meest recente keuze in elke groep',
  'sections.inspector.dedupe': 'Ontdubbelen',
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
  // as-keuze (Geologie / Litho / Geotech)
  // ---------------------------------------------------------------------------
  // "Geo", "Litho" en "Geotech" blijven ongewijzigd — het zijn de korte
  // segmentlabels, net als de F-Strat / I-Strat afkortingen (INTENTIONALLY_IDENTICAL).
  'sections.axis.geoShort': 'Geo',
  'sections.axis.litho': 'Litho',
  'sections.axis.geotech': 'Geotech',
  'sections.axis.createLithoFirst':
    'Maak eerst een lithostratigrafisch model aan in de lithologiestap',
  'sections.axis.editLithoContacts':
    'De laaggrenzen van het lithostratigrafisch model op dit profiel bewerken',
  'sections.axis.createLithoForPacking':
    'Maak eerst een lithostratigrafisch model aan — pakking verdeelt de lithostratigrafische lichamen onder',
  'sections.axis.viewGeotech':
    'Bekijk de geotechnische onderverdeling (NAD-pakkingsklassen) op dit profiel',
  'sections.axis.noGeotechYet':
    'Nog geen geotechnisch model — “Pakkingsstroom → 1 · Sonderingen onderverdelen” maakt het aan',

  // ---------------------------------------------------------------------------
  // modelniveau-woorden (geïnterpoleerd in de export- en herbereken-tooltips)
  // ---------------------------------------------------------------------------
  'sections.level.litho': 'lithostratigrafisch',
  'sections.level.geotech': 'geotechnisch',
  'sections.level.geological': 'geologisch',
  'sections.level.geotechShort': 'geotechnisch',

  // ---------------------------------------------------------------------------
  // tijdelijke bezig-labels
  // ---------------------------------------------------------------------------
  'sections.busy.accepting': 'Aanvaarden…',
  'sections.busy.creating': 'Aanmaken…',
  'sections.busy.deleting': 'Verwijderen…',
  'sections.busy.recomputing': 'Herberekenen…',
  'sections.busy.exporting': 'Exporteren…',
  'sections.busy.suggesting': 'Voorstellen…',
  'sections.busy.subdividing': 'Onderverdelen…',
  'sections.busy.correlating': 'Correleren…',
  'sections.busy.dividing': 'Verdelen…',

  // ---------------------------------------------------------------------------
  // staartwerkwoorden — Nieuw / Verwijderen / Koppelprofielen / Herberekenen
  // ---------------------------------------------------------------------------
  'sections.tail.newSection': 'Nieuw dwarsprofiel',
  'sections.tail.newSectionTitle': 'Een nieuw dwarsprofiel aanmaken (voorlopige eindpunten)',
  'sections.tail.delete': 'Verwijderen',
  'sections.tail.deleteSectionMenu': 'Dwarsprofiel verwijderen…',
  'sections.tail.deleteSelectFirst': 'Selecteer een dwarsprofiel om te verwijderen',
  'sections.tail.deleteConfirmMenuTitle': '"{name}" verwijderen — vraagt eerst om bevestiging',
  'sections.tail.deleteTitle': '"{name}" verwijderen',
  'sections.tail.recompute': 'Lichamen herberekenen',
  'sections.tail.recomputeNone': 'Geen actief {level} model om te herberekenen',
  'sections.tail.recomputeTitle':
    'De vastgelegde geometrische lichaamsidentiteit nu opnieuw afleiden uit de huidige profielen',

  // ---------------------------------------------------------------------------
  // koppelprofielen (staart)
  // ---------------------------------------------------------------------------
  'sections.tie.suggestSections': 'Koppelprofielen voorstellen',
  'sections.tie.clearSuggestions': 'Koppelvoorstellen wissen',
  'sections.tie.acceptAll': 'Alle koppelingen aanvaarden',
  'sections.tie.acceptAllRunFirst': 'Gebruik eerst "Koppelprofielen voorstellen"',
  'sections.tie.acceptAllBusy': 'Dwarsprofielen aanmaken voor alle voorgestelde koppelingen…',
  'sections.tie.acceptAllTitle': 'Maak een dwarsprofiel aan voor elke voorgestelde koppeling',
  'sections.tie.needTwo': 'Er zijn minstens 2 profielen nodig om te koppelen',
  'sections.tie.clearTitle': 'De huidige koppelprofielvoorstellen wissen',
  'sections.tie.suggestTitle':
    'Stel loodrechte verbindingsprofielen voor tussen bestaande profielen (geen kruisingen, geen gedeelde proeven)',

  // ---------------------------------------------------------------------------
  // export-menu
  // ---------------------------------------------------------------------------
  'sections.export.selectSection': 'Selecteer een profiel om te exporteren',
  'sections.export.dropdownTitle': 'Exporteer het model of dit profiel',
  'sections.export.sectionDxf': 'Profiel-DXF',
  'sections.export.exportingDxf': 'DXF exporteren…',
  'sections.export.noModelContacts': 'Geen actief {level} model — er moeten eerst laaggrenzen bestaan',
  'sections.export.dxfTitle': 'Exporteer het {level} model van dit profiel als DXF',
  'sections.export.plaxisScript': 'Plaxis 3D-script',
  'sections.export.exportingPlaxis': 'Plaxis exporteren…',
  'sections.export.noGeologicalModel': 'Geen actief geologisch model',
  'sections.export.plaxisTitle':
    'Exporteer het geologisch model als een Plaxis 3D plxscripting Python-script',
  'sections.export.sectionPdf': 'Profiel-PDF-rapport',
  'sections.export.generatingPdf': 'PDF genereren…',
  'sections.export.noModelDefine': 'Geen actief {level} model — bepaal er eerst een',
  'sections.export.pdfTitle': 'Genereer een PDF-rapport van het {level} model van dit profiel',
  // "D-Stability (.stix)" / "D-Sheet Piling (.shi)" blijven ongewijzigd
  // (product- + bestandsformaatnamen).
  'sections.export.dstability': 'D-Stability (.stix)',
  'sections.export.exportingDstability': 'D-Stability exporteren…',
  'sections.export.dsheetpiling': 'D-Sheet Piling (.shi)',
  'sections.export.exportingDsheetpiling': 'D-Sheet Piling exporteren…',
  'sections.export.dstabilityFilter': 'D-Stability-model',
  'sections.export.dsheetpilingFilter': 'D-Sheet Piling-profiel',
  'sections.export.dstabilitySuccess': 'D-Stability-model geëxporteerd.',
  'sections.export.dsheetpilingSuccess': 'D-Sheet Piling-profiel geëxporteerd.',
  'sections.export.dstabilityFailure': 'Kon het D-Stability-model niet exporteren.',
  'sections.export.dsheetpilingFailure': 'Kon het D-Sheet Piling-profiel niet exporteren.',
  'sections.export.dstabilityDescribes':
    'model als een D-Stability .stix (enkel geometrie — geen ontwerpparameters)',
  'sections.export.dsheetpilingDescribes':
    'model als een D-Sheet Piling .shi grondprofiel doorheen het profiel (enkel geometrie)',
  'sections.export.dseriesRowTitle': 'Exporteer het {level} {describes} van dit profiel',
  'sections.export.nothingDrawn':
    'Niets om te exporteren — dit profiel heeft geen getekende {level} geometrie tussen twee kolommen.',
  'sections.export.readFailed': 'Kon dit profiel niet lezen — er is niets geëxporteerd.',

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
  // litho-as werkbalkwerkwoorden + menu's
  // FLAG: "CPT" wordt hier vertaald als "sondering/sondeer-" (bestaande
  // catalogusconventie); de eigenaar heeft "Sondering vs CPT" nog niet beslist.
  // ---------------------------------------------------------------------------
  'sections.litho.suggest': 'Voorstellen',
  'sections.litho.suggestAll': 'Alles voorstellen',
  'sections.litho.createModelFirst': 'Maak eerst een lithostratigrafisch model aan',
  'sections.litho.openSectionSuggest': 'Open een dwarsprofiel om Voorstellen te gebruiken',
  'sections.litho.fetchingSuggestions': 'Voorstellen ophalen…',
  'sections.litho.suggestAllTitle':
    'Rechtsklik een kolom om er één te focussen, of klik om lagen voor te stellen voor elk grondonderzoek op dit profiel ({n})',
  'sections.litho.suggestFocusHint':
    'Rechtsklik een kolom op het profiel om een sondering of boring te focussen, en klik dan op Voorstellen',
  'sections.litho.suggestForColumn': 'Lithostratigrafische lagen voorstellen voor {column}',
  'sections.litho.theFocusedInvestigation': 'het gefocuste grondonderzoek',
  'sections.litho.acceptAll': 'Alles aanvaarden',
  'sections.litho.committingSuggestions': 'Alle voorgestelde lagen vastleggen…',
  'sections.litho.acceptAllTitle':
    'Aanvaard alle niet-verworpen voorgestelde lagen als lithostratigrafische laaggrenzen',
  'sections.litho.clear': 'Wissen',
  'sections.litho.acceptAllBulk': 'Alles aanvaarden (bulk)',
  'sections.litho.committingBulk': 'Alle voorgestelde bulklagen vastleggen…',
  'sections.litho.acceptAllBulkTitle':
    'Aanvaard elk niet-verworpen voorstel over alle {n} bulk-ghost {investigation}',
  'sections.litho.investigationOne': 'grondonderzoek',
  'sections.litho.investigationMany': 'grondonderzoeken',
  'sections.litho.clearBulk': 'Bulk wissen',
  'sections.litho.correlateActive': 'Correleren · klik 2 banden',
  'sections.litho.correlate': 'Correleren',
  'sections.litho.enterCorrelate': 'Correlatiemodus openen',
  'sections.litho.exitCorrelate': 'Correlatiemodus verlaten',
  'sections.litho.openSectionCorrelate': 'Open een dwarsprofiel om eenheden te correleren',
  'sections.litho.acceptFirstToCorrelate':
    'Aanvaard lithovoorstellen om te kunnen correleren — 0 aanvaarde laaggrenzen op dit profiel',
  'sections.litho.exitCorrelateEsc': 'Correlatiemodus verlaten (Esc)',
  'sections.litho.enterCorrelateTitle':
    'Correlatiemodus openen — klik een eenheidsband op één grondonderzoek en dan een overeenkomende eenheid op een ander om ze te koppelen',
  'sections.litho.bodiesTitle':
    'Wiggen van lichamen (lenzen) detecteren, voorstellen, materialiseren of wissen',
  'sections.litho.admixturesDisabled':
    'Stel eerst litholagen voor — bijmengingsbewerkingen werken op de voorstellen',
  'sections.litho.admixturesTitle':
    'Bijmengingen op de huidige voorstellen verwijderen of opnieuw inlezen',
  'sections.litho.suggestAllInSection': 'Alles op dit profiel voorstellen',
  'sections.litho.openSectionFirst': 'Open eerst een dwarsprofiel',
  'sections.litho.runningSegmenterAll':
    'Segmenteerder uitvoeren op elk grondonderzoek op dit profiel…',
  'sections.litho.suggestAllInSectionTitle':
    'Stel in één keer lithostratigrafische lagen voor voor elk grondonderzoek op dit profiel',
  'sections.litho.suggestNewTests': 'Voorstellen voor nieuwe proeven',
  'sections.litho.runningSegmenter': 'Segmenteerder uitvoeren…',
  'sections.litho.allHaveContacts':
    'Alle zichtbare grondonderzoeken hebben al laaggrenzen — importeer nieuwe proeven om dit te gebruiken',
  'sections.litho.suggestNewTestsTitle':
    'Lagen voorstellen voor de {n} {investigation} zonder litholaaggrenzen',
  'sections.litho.autoCorrelate': 'Automatisch correleren',
  'sections.litho.runningAutoCorrelate': 'Automatisch correleren…',
  'sections.litho.autoCorrelateTitle':
    'Automatisch correleren: koppel laaggrenzen bij naburige grondonderzoeken binnen een diepte- + afstandstolerantie — voegt niet-goedgekeurde randen toe over het hele model. Gebruik "Correlaties aanvaarden" om goed te keuren.',
  'sections.litho.acceptCorrelations': 'Correlaties aanvaarden',
  'sections.litho.openSectionAcceptCorr': 'Open een dwarsprofiel om correlaties te aanvaarden',
  'sections.litho.acceptingCorrelations': 'Correlaties aanvaarden…',
  'sections.litho.acceptCorrelationsTitle':
    'Aanvaard alle niet-goedgekeurde correlatieranden op laaggrensniveau op dit profiel — legt lenslichamen vast en herberekent de rangordes',
  'sections.litho.clearCorrelationsTitle':
    'Verwijder alle niet-goedgekeurde correlatievoorstellen over het hele model (behoudt goedgekeurde correlaties). Omkeerbaar — voer opnieuw Automatisch correleren uit om ze opnieuw te genereren.',
  'sections.litho.fillBands': 'Banden vullen',
  'sections.litho.hideBands': 'Banden verbergen',
  'sections.litho.showCorrelations': 'Correlaties tonen',
  'sections.litho.hideCorrelations': 'Correlaties verbergen',
  'sections.litho.showModelFill': 'Modelvulling tonen',
  'sections.litho.hideModelFill': 'Modelvulling verbergen',
  'sections.litho.resetManualPoints': 'Handmatige punten herstellen',
  'sections.litho.resetting': 'Herstellen…',
  'sections.litho.resetManualPointsTitle':
    'Wis elk handgetekend lichaamsgrenspunt in dit model. De lichamen keren terug naar hun berekende vorm. Kan niet ongedaan gemaakt worden.',
  'sections.litho.stripCptAdmixtures': 'Sondeerbijmengingen verwijderen',
  'sections.litho.noCptGhosts': 'Geen sondeervoorstellen',
  'sections.litho.stripCptTitle': 'Bijmengingen uit elk sondeervoorstel wissen',
  'sections.litho.stripBoreholeAdmixtures': 'Boringbijmengingen verwijderen',
  'sections.litho.noBoreholeGhosts': 'Geen boringvoorstellen',
  'sections.litho.stripBoreholeTitle': 'Bijmengingen uit elk boringvoorstel wissen',
  'sections.litho.reseedBoreholeTitle':
    'Herstel de bijmengingen van de segmenteerder op boringvoorstellen (een verwijdering ongedaan maken)',

  // ---------------------------------------------------------------------------
  // monsterweergave-schakelaars (gedeeld door litho Lichamen + geotech Weergave)
  // ---------------------------------------------------------------------------
  'sections.samples.show': 'Monsters tonen',
  'sections.samples.hide': 'Monsters verbergen',
  'sections.samples.showPsd': 'Korrelverdeling tonen bij zweven',
  'sections.samples.hidePsd': 'Korrelverdeling verbergen bij zweven',

  // ---------------------------------------------------------------------------
  // geotech-as werkbalkwerkwoorden + menu's
  // ---------------------------------------------------------------------------
  'sections.geotech.statisticMenuTitle':
    'Welke representatieve qc de NAD-classificatie leest, te kiezen VOOR je onderverdeelt: mediaan (spike-robuuste standaard), rekenkundig, harmonisch (conservatief — gewogen naar de lage waarden die draagvermogen en zetting bepalen) of geometrisch. Er wordt niets geherclassificeerd wanneer je het wijzigt: de keuze geldt voor de VOLGENDE "1 · Sonderingen onderverdelen"; banden die al op het scherm staan behouden de statistiek waarmee ze opgebouwd zijn tot je ze opnieuw uitvoert.',
  'sections.geotech.pipeline': 'Pakkingsstroom',
  'sections.geotech.correlatePacking': 'Pakking correleren',
  'sections.geotech.exitPackingCorrelate': 'Pakkingscorrelatiemodus verlaten',
  'sections.geotech.correlatePackingByHand': 'Pakking handmatig correleren',
  'sections.geotech.correlatePackingNoModel':
    'Gebruik eerst “1 · Sonderingen onderverdelen” om pakkingsbanden aan te maken',
  'sections.geotech.exitPackingCorrelateEsc': 'Pakkingscorrelatiemodus verlaten (Esc)',
  'sections.geotech.correlatePackingTitle':
    'Verbind pakkingsbanden van dezelfde klasse over grondonderzoeken binnen hetzelfde lithostratigrafisch lichaam — de handmatige correlatie die stap 2 van de reeks automatiseert',
  'sections.geotech.currentTag': 'huidig',
  'sections.geotech.harmonicHint':
    'Conservatief: gewogen naar de lage qc-waarden die draagvermogen en zetting bepalen.',
  'sections.geotech.medianHint': 'De spike-robuuste standaard.',
  'sections.geotech.step1': '1 · Sonderingen onderverdelen',
  'sections.geotech.reRunUnder': 'opnieuw uitvoeren onder {stat}',
  'sections.geotech.columnsNeedRederive': '{n} {phrase} opnieuw afgeleid worden',
  'sections.geotech.columnNeeds': 'kolom moet',
  'sections.geotech.columnsNeed': 'kolommen moeten',
  'sections.geotech.step1OpenSection':
    'Open eerst een dwarsprofiel — deze stap verdeelt de sonderingen op het profiel dat je open hebt onder',
  'sections.geotech.step1Title':
    'Stap 1 van 4 — leid NAD-pakkingsklassen (1–31) af op de sonderingen van DIT profiel, en laat de banden, koppelingen en lichamen van elk ander profiel ongemoeid. Correleert niets: “2 · Automatisch correleren” stelt daarna de pakkingskoppelingen voor. Maakt het geotechnisch model aan bij de eerste uitvoering. Een sondering die op geen enkel dwarsprofiel ligt, wordt nooit onderverdeeld.',
  'sections.geotech.step2': '2 · Automatisch correleren',
  'sections.geotech.step2OpenSection':
    'Open eerst een dwarsprofiel — deze stap stelt koppelingen voor op het profiel dat je open hebt',
  'sections.geotech.noBandsHere':
    'Nog geen pakkingsbanden op dit profiel — gebruik eerst “1 · Sonderingen onderverdelen” op dit profiel',
  'sections.geotech.step2Title':
    'Stap 2 van 4 — leid de pakkingskoppelingen van dezelfde klasse af binnen elke gecorreleerde litho-eenheid OP DIT PROFIEL, en spring over boorkolommen die nog geen pakking dragen. Koppelingen die een litho-correlatie herhalen die je al goedgekeurd hebt, komen AANVAARD binnen; de rest komt als voorstel. Handgetekende correlaties worden nooit aangeraakt.',
  'sections.geotech.step3': '3 · Koppelingen aanvaarden',
  'sections.geotech.pendingHere': '{n} openstaand hier',
  'sections.geotech.step3OpenSection':
    'Open eerst een dwarsprofiel — deze stap aanvaardt de koppelingen op het profiel dat je open hebt',
  'sections.geotech.step3Title':
    'Stap 3 van 4 — nakijken, dan goedkeuren, op het profiel voor je. Verwijder EERST de foute voorstellen (rechtsklik een koppeling → Verwijderen) en aanvaard degene die je één voor één wil afvinken (rechtsklik → Koppeling aanvaarden). Druk daarna hierop om elk resterend voorstel OP DIT PROFIEL te aanvaarden. Verbind daarna met de hand wat automatisch correleren gemist heeft via “Pakking correleren”.',
  'sections.geotech.step4': '4 · Boringen verdelen',
  'sections.geotech.staleReDivide': 'verouderd — opnieuw verdelen',
  'sections.geotech.step4OpenSection':
    'Open eerst een dwarsprofiel — deze stap verdeelt de boringen op het profiel dat je open hebt',
  'sections.geotech.staleReDivideTitle':
    'Lichamen of correlaties zijn gewijzigd — verdeel de boringen opnieuw om overeen te komen',
  'sections.geotech.step4Title':
    'Stap 4 van 4 — verdeel de boorkolommen van DIT profiel met TIN in pakkingsbanden, met de sondeer-overgangsvlakken en de koppelingen die je aanvaard hebt, en laat elk ander profiel ongemoeid. Rechtsklik de ghost-banden van één boring om enkel die kolom te verdelen.',
  'sections.geotech.showFill': 'Vulling tonen',
  'sections.geotech.hideFill': 'Vulling verbergen',
  'sections.geotech.showLithoFill': 'Lithovulling tonen',
  'sections.geotech.hideLithoFill': 'Lithovulling verbergen',
  'sections.geotech.showBoreholePreview': 'Voorbeeld boringen tonen',
  'sections.geotech.hideBoreholePreview': 'Voorbeeld boringen verbergen',
  'sections.geotech.correlationsHint':
    'Toon of verberg de correlatielinten over het profiel (enkel 2D-visualisatie).',

  // openstaande-koppelingen-chip + tooltip (utils/geotechPendingScope)
  'sections.geotech.pendingModel': '{n} openstaand',
  'sections.geotech.tiesOne': '{n} pakkingskoppeling',
  'sections.geotech.tiesMany': '{n} pakkingskoppelingen',
  'sections.geotech.sectionsOne': '{n} profiel',
  'sections.geotech.sectionsMany': '{n} profielen',
  'sections.geotech.pendingTitleModel':
    '{ties} voorgesteld en nog niet aanvaard ({accepted} aanvaard).',
  'sections.geotech.pendingTitleSection':
    '{sectionPending} van {ties} voorgesteld op dit profiel ({accepted} aanvaard modelbreed).{rest}',
  'sections.geotech.pendingElsewhere':
    ' De andere {elsewhere} liggen op {sections}, die “4 · Boringen verdelen” ook leeg moet hebben.',
  'sections.geotech.pendingNowhereElse': ' Er staat nergens anders in het model iets open.',
  'sections.geotech.divideTagModel': 'aanvaard er eerst {n}',
  'sections.geotech.divideTagSection': 'aanvaard er {n} op dit profiel',
  'sections.geotech.divideTitleModel':
    '{ties} nog voorgesteld — aanvaard of verwijder ze eerst',
  'sections.geotech.divideTitleSection':
    '{ties} nog voorgesteld op dit profiel. Bij het verdelen van de boringen leest het de koppelingen die je aanvaard hebt om te bepalen waar de pakking van elke boring vandaan komt — aanvaard of verwijder deze eerst. Niets op een ander profiel wordt aangeraakt.',

  // verouderde-litho-kolomchip + tooltip (utils/staleGeotechColumns)
  'sections.geotech.staleChipLabel': '{n} op bewerkte litho',
  'sections.geotech.staleTitleNone': 'Elke pakkingskolom komt overeen met de lithologie eronder.',
  'sections.geotech.staleAndMore': '{named} en {rest} andere',
  'sections.geotech.staleTitleOne':
    'De lithologie van deze kolom is veranderd nadat de pakkingsbanden gemaakt zijn: {list}. De banden beschrijven nog de oude opeenvolging — voer de onderverdeling op deze kolom opnieuw uit ("1 · Sonderingen onderverdelen" voor proeven, "4 · Boringen verdelen" voor boringen) voor je exporteert.',
  'sections.geotech.staleTitleMany':
    'De lithologie van deze kolommen is veranderd nadat de pakkingsbanden gemaakt zijn: {list}. De banden beschrijven nog de oude opeenvolging — voer de onderverdeling op deze kolommen opnieuw uit ("1 · Sonderingen onderverdelen" voor proeven, "4 · Boringen verdelen" voor boringen) voor je exporteert.',

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
  'sections.menu.unitStatistics': 'Statistieken van deze eenheid…',
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
