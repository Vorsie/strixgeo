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
  // Presentatiegrens-vertaling van de Engelse canonieke standaardnamen
  // ("Cross-section N" / "Tie-section N", opgeslagen bij aanmaken). Alleen de
  // onaangeroerde standaardnamen worden vertaald; een hernoemd profiel toont zijn
  // eigen naam ongewijzigd. ``{n}`` is het volgnummer (owner: Dwarsprofiel /
  // Koppelprofiel, ruling 2026-08-31).
  'sections.kindLabel.cross': 'Dwarsprofiel {n}',
  'sections.kindLabel.tie': 'Koppelprofiel {n}',
  'sections.properties': 'Eigenschappen van het profiel',
  'sections.modelActions': 'Modelacties',
  'sections.moreActions': 'Meer profielacties',
  // Koppen van het ⋯ Meer-menu. "Model" en "Export" zijn in het BE-Nederlands
  // dezelfde woorden als in het Engels (zie INTENTIONALLY_IDENTICAL in
  // localeParity.test.ts); "Section" wordt "Profiel", zoals overal elders.
  'sections.moreGroup.model': 'Model',
  'sections.moreGroup.section': 'Profiel',
  'sections.moreGroup.export': 'Export',
  'sections.geoVerbHint':
    'Schakel naar de stratigrafie-as — Bouwen / Vullen / Ontdubbelen / Plaxis-3D werken op het stratigrafisch model',
  'sections.undoTitle': 'Maak de laatste modelbewerking ongedaan (Ctrl+Z)',
  'sections.undoNothing': 'Niets om ongedaan te maken',
  // Waarschuwing als de automatische herberekening van de lichaamsidentiteit
  // mislukt (owner ruling 6): de handmatige knop is weg, dus een mislukking
  // moet de gebruiker nog steeds melden dat de identiteit niet is bewaard.
  'sections.recompute.backgroundFailed':
    'Lichaamsidentiteit kon niet op de achtergrond worden bewaard. Bij je volgende bewerking wordt het opnieuw geprobeerd.',
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
  'sections.inspector.representativeQc': 'Representatieve qc',
  // De gekozen statistiek, eenmaal getoond (owner ruling 5). De token
  // (median / harmonic / …) is een technische term die letterlijk wordt
  // getoond, dezelfde waarde als de qc-keuzelijst in de werkbalk.
  'sections.inspector.chosenStatistic': 'Statistiek: {statistic}',
  'sections.inspector.geologicalModel': 'Stratigrafisch model',
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
    'Schakel naar de stratigrafie-as — Bouwen / Ontdubbelen werken op het stratigrafisch model',
  'sections.inspector.buildNoModel':
    'Geen actief stratigrafisch model — maak eerst formaties en laaggrenzen aan',
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
  'sections.inspector.noParentGeoModel': 'Geen bovenliggend stratigrafisch model gekoppeld',
  'sections.inspector.loadingGeoSurfaces': 'Stratigrafische oppervlakken laden…',
  'sections.inspector.syncGeologyTitle':
    'Laad de oppervlakken van het bovenliggende stratigrafische model als een alleen-lezen achtergrondreferentie op dit profiel',
  'sections.inspector.syncing': 'Synchroniseren…',
  'sections.inspector.syncGeology': 'Stratigrafie synchroniseren',
  'sections.inspector.seedDefineFirst':
    'Definieer eerst formaties in de stratigrafiestap — Vullen plaatst laaggrenzen voor reeds gedefinieerde lagen',
  'sections.inspector.seedingContacts': 'Laaggrenzen vullen uit de boorstratigrafie…',
  'sections.inspector.seedTitle':
    'Plaats laaggrenzen uit boorwaarnemingen voor formaties die al in het model gedefinieerd zijn — voer Ontdubbelen uit als er dubbels verschijnen',
  'sections.inspector.seeding': 'Vullen…',
  'sections.inspector.seed': 'Vullen',
  'sections.inspector.seedDefineFirstShort': 'Definieer eerst formaties in de stratigrafiestap',
  'sections.inspector.allHaveGeologyContacts':
    'Alle boringen in bereik hebben al stratigrafische laaggrenzen — importeer nieuwe proeven om dit te gebruiken',
  'sections.inspector.seedNewTestsTitleOne':
    'Plaats laaggrenzen uit de stratigrafie voor de {n} boring zonder stratigrafische laaggrenzen',
  'sections.inspector.seedNewTestsTitleMany':
    'Plaats laaggrenzen uit de stratigrafie voor de {n} boringen zonder stratigrafische laaggrenzen',
  'sections.inspector.seedForNewTests': 'Vullen voor nieuwe proeven',
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
  'sections.referenceGeologicalModel': 'Referentie-stratigrafisch model',
  'sections.geologyBackdrop': 'Stratigrafische achtergrond (litho-as)',
  'sections.geologyBackdropHint':
    'Wordt als vage referentielaag getoond wanneer de litho-as actief is.',
  'sections.syncGeology': 'Stratigrafie synchroniseren',
  'sections.boreholePreview': 'Voorbeeld boringen',
  'sections.virtueleBoringOverlay': 'Overlay Virtuele Boring',
  'sections.viewTabMap': 'Kaart',
  'sections.viewTabSection': 'Profiel',
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
    'Maak eerst een lithologisch model aan in de lithologiestap',
  'sections.axis.editLithoContacts':
    'De laaggrenzen van het lithologisch model op dit profiel bewerken',
  'sections.axis.createLithoForPacking':
    'Maak eerst een lithologisch model aan — pakking verdeelt de lithologische lichamen onder',
  'sections.axis.viewGeotech':
    'Bekijk de geotechnische onderverdeling (NAD-pakkingsklassen) op dit profiel',
  'sections.axis.noGeotechYet':
    'Nog geen geotechnisch model — “Pakkingsstroom → 1 · Sonderingen onderverdelen” maakt het aan',

  // ---------------------------------------------------------------------------
  // modelniveau-woorden (geïnterpoleerd in de export- en herbereken-tooltips)
  // ---------------------------------------------------------------------------
  'sections.level.litho': 'lithologisch',
  'sections.level.geotech': 'geotechnisch',
  'sections.level.geological': 'stratigrafisch',

  // ---------------------------------------------------------------------------
  // tijdelijke bezig-labels
  // ---------------------------------------------------------------------------
  'sections.busy.accepting': 'Aanvaarden…',
  'sections.busy.creating': 'Aanmaken…',
  'sections.busy.deleting': 'Verwijderen…',
  'sections.busy.exporting': 'Exporteren…',
  'sections.busy.suggesting': 'Voorstellen…',
  'sections.busy.subdividing': 'Onderverdelen…',
  'sections.busy.correlating': 'Correleren…',
  'sections.busy.dividing': 'Verdelen…',

  // ---------------------------------------------------------------------------
  // staartwerkwoorden — Nieuw / Verwijderen / Koppelprofielen
  // ---------------------------------------------------------------------------
  'sections.tail.newSection': 'Nieuw dwarsprofiel',
  'sections.tail.newSectionTitle': 'Een nieuw dwarsprofiel aanmaken (voorlopige eindpunten)',
  'sections.tail.delete': 'Verwijderen',
  'sections.tail.deleteSectionMenu': 'Dwarsprofiel verwijderen…',
  'sections.tail.deleteSelectFirst': 'Selecteer een dwarsprofiel om te verwijderen',
  'sections.tail.deleteConfirmMenuTitle': '"{name}" verwijderen — vraagt eerst om bevestiging',
  'sections.tail.deleteTitle': '"{name}" verwijderen',

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
  'sections.export.hubJumpTitle': 'Open de Export-stap met dit profiel geselecteerd',
  'sections.export.sectionDxf': 'Profiel-DXF',
  'sections.export.exportingDxf': 'DXF exporteren…',
  'sections.export.noModelContacts': 'Geen actief {level} model — er moeten eerst laaggrenzen bestaan',
  'sections.export.dxfTitle': 'Exporteer het {level} model van dit profiel als DXF',
  'sections.export.plaxisScript': 'Plaxis 3D-script',
  'sections.export.exportingPlaxis': 'Plaxis exporteren…',
  'sections.export.noGeologicalModel': 'Geen actief stratigrafisch model',
  'sections.export.plaxisTitle':
    'Exporteer het stratigrafisch model als een Plaxis 3D plxscripting Python-script',
  'sections.export.sectionPdf': 'Profiel-PDF-rapport',
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
    'Niets om te exporteren: dit profiel heeft geen getekende {level} geometrie tussen twee kolommen.',
  'sections.export.readFailed': 'Kon dit profiel niet lezen — er is niets geëxporteerd.',

  // ---------------------------------------------------------------------------
  // werkbalk
  // ---------------------------------------------------------------------------
  'sections.toolbar.display': 'Weergave',
  // FLAG alt: Bodies | Eenheden — the section toolbar's group of body verbs.
  'sections.toolbar.bodies': 'Lichamen',
  'sections.toolbar.geology': 'Stratigrafie',
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
    'De laaggrenzen van het stratigrafisch model op dit profiel bewerken',
  'sections.toolbar.noLithoModel':
    'Geen lithologisch model — maak er een aan in de lithologiestap.',
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
    'Wissel de lithologische vulling in voor de NAD-pakkingsvulling — er wordt telkens één vulling getekend, nooit beide.',
  'sections.toolbar.qcStatisticHint':
    'Welke representatieve qc de NAD-classificatie leest, te kiezen VOOR je de pakkingsbanden eronder opbouwt. De keuze geldt voor de VOLGENDE "1 · Sonderingen onderverdelen"; banden die al op het scherm staan behouden de statistiek waarmee ze opgebouwd zijn tot je ze opnieuw uitvoert.',
  'sections.toolbar.sampleMarkersHint':
    'Toon of verberg de monstermarkeringen op de boorkolommen. Elke markering beslaat het diepte-interval waarover het monster genomen is.',
  'sections.toolbar.psdCardHint':
    'Toon een kaartje met de korrelverdeling terwijl je over een monstermarkering zweeft. Druk op P om dit om te zetten zonder dit menu te openen.',

  // ---------------------------------------------------------------------------
  // litho-as werkbalkwerkwoorden + menu's
  // FLAG: "CPT" wordt hier vertaald als "sondering/sondeer-" (bestaande
  // catalogusconventie); eigenaar 2026-08-31: "Sondering (CPT)" bij de eerste vermelding per scherm, daarna Sondering.
  // ---------------------------------------------------------------------------
  'sections.litho.suggest': 'Voorstellen',
  'sections.litho.suggestAll': 'Alles voorstellen',
  'sections.litho.createModelFirst': 'Maak eerst een lithologisch model aan',
  'sections.litho.openSectionSuggest': 'Open een dwarsprofiel om Voorstellen te gebruiken',
  'sections.litho.fetchingSuggestions': 'Voorstellen ophalen…',
  'sections.litho.suggestAllTitle':
    'Rechtsklik een kolom om er één te focussen, of klik om lagen voor te stellen voor elk grondonderzoek op dit profiel ({n})',
  'sections.litho.suggestFocusHint':
    'Rechtsklik een kolom op het profiel om een sondering of boring te focussen, en klik dan op Voorstellen',
  'sections.litho.suggestForColumn': 'Lithologische lagen voorstellen voor {column}',
  'sections.litho.theFocusedInvestigation': 'het gefocuste grondonderzoek',
  'sections.litho.acceptAll': 'Alles aanvaarden',
  'sections.litho.committingSuggestions': 'Alle voorgestelde lagen vastleggen…',
  'sections.litho.acceptAllTitle':
    'Aanvaard alle niet-verworpen voorgestelde lagen als lithologische laaggrenzen',
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
    'Lichaamsbanden vullen, overlays tonen/verbergen en handmatige punten herstellen',
  'sections.litho.admixturesDisabled':
    'Stel eerst litholagen voor — bijmengingsbewerkingen werken op de voorstellen',
  'sections.litho.admixturesTitle':
    'Bijmengingen op de huidige voorstellen verwijderen of opnieuw inlezen',
  'sections.litho.suggestAllInSection': 'Alles op dit profiel voorstellen',
  'sections.litho.openSectionFirst': 'Open eerst een dwarsprofiel',
  'sections.litho.runningSegmenterAll':
    'Segmenteerder uitvoeren op elk grondonderzoek op dit profiel…',
  'sections.litho.suggestAllInSectionTitle':
    'Stel in één keer lithologische lagen voor voor elk grondonderzoek op dit profiel',
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
    'Verbind pakkingsbanden van dezelfde klasse over grondonderzoeken binnen hetzelfde lithologisch lichaam — de handmatige correlatie die stap 2 van de reeks automatiseert',
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
    'Stap 1 van 4 — leid NAD-pakkingsklassen (1–31) af op de sonderingen van DIT profiel, en laat de banden, koppelingen en lichamen van elk ander profiel ongemoeid. Correleert niets: “2 · Automatisch correleren” stelt daarna de pakkingscorrelaties voor. Maakt het geotechnisch model aan bij de eerste uitvoering. Een sondering die op geen enkel dwarsprofiel ligt, wordt nooit onderverdeeld.',
  'sections.geotech.step2': '2 · Automatisch correleren',
  'sections.geotech.step2OpenSection':
    'Open eerst een dwarsprofiel — deze stap stelt koppelingen voor op het profiel dat je open hebt',
  'sections.geotech.noBandsHere':
    'Nog geen pakkingsbanden op dit profiel — gebruik eerst “1 · Sonderingen onderverdelen” op dit profiel',
  'sections.geotech.step2Title':
    'Stap 2 van 4 — leid de pakkingscorrelaties van dezelfde klasse af binnen elke gecorreleerde litho-eenheid OP DIT PROFIEL, en spring over boorkolommen die nog geen pakking dragen. Koppelingen die een litho-correlatie herhalen die je al goedgekeurd hebt, komen AANVAARD binnen; de rest komt als voorstel. Handgetekende correlaties worden nooit aangeraakt.',
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
  'sections.geotech.tiesOne': '{n} pakkingscorrelatie',
  'sections.geotech.tiesMany': '{n} pakkingscorrelaties',
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
  'sections.geotech.staleInspectorLabel': 'Pakking verouderd',
  'sections.geotech.staleInspectorBody':
    'Pakking op {list} is afgeleid van een oudere lithologie. Druk op Onderverdelen om ze opnieuw af te leiden.',
  'sections.geotech.staleInspectorSubdivide': 'Onderverdelen',

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
  'sections.hints.panZoom':
    'Sleep om te pannen · scroll om te zoomen · rechtsklik een kolom om te focussen · dubbelklik een kolom om te openen',
  'sections.hints.lithoLayer':
    'Litholaag: dubbelklik om te aanvaarden · Alt+slepen om de samenstelling te kopiëren · sleep een grens op de buur en laat los om samen te voegen · rechtsklik voor meer',
  'sections.hints.acceptFirst':
    'Aanvaard lithovoorstellen om te kunnen correleren: 0 aanvaarde laaggrenzen op dit profiel.',
  'sections.hints.buildGeotechFirst':
    'Bouw het geotechnisch model voor dit profiel op voor je een NAD-onderverdeling voorstelt.',

  // ---------------------------------------------------------------------------
  // contextmenu's
  // ---------------------------------------------------------------------------
  'sections.menu.body': 'Acties op de lichaamsuitbreiding',
  // NOTE: ruled 2026-08-27 — owner chose "Lichaam ontbinden".
  'sections.menu.dissolveBody': 'Lichaam ontbinden',
  'sections.menu.nameBody': 'Lichaam benoemen…',
  // Body-verb simplification (owner ruling 2026-09-01 "way too complicated"):
  // Join + Ontkoppelen only. Separate / Rejoin removed. Owner RULED: Join reads
  // "Voeg samen met…"; the un-join reads "Ontkoppelen" (his approved word). The
  // "van {label}" suffix names which group is lifted when a body sits in several
  // (FLAG: the suffix wording is mine, not owner-ruled verbatim).
  'sections.menu.joinBody': 'Voeg samen met…',
  'sections.menu.unjoinBody': 'Ontkoppelen van {label}',
  // FLAG alt: Focus op dit onderzoekspunt | Focus op deze kolom — "test" here
  // means one CPT or borehole column on the section.
  'sections.menu.focusTest': 'Focus op deze proef',
  'sections.menu.openDetail': 'Details openen',
  'sections.menu.removeFromSection': 'Uit dit profiel verwijderen',
  'sections.menu.clearSubdivision': 'Onderverdeling wissen',
  // FLAG: not owner-ruled — the column context menu's aria-label. ``{name}`` is
  // the column display name.
  'sections.menu.actionsFor': 'Acties voor {name}',
  'sections.menu.deleteContact': 'Laaggrens verwijderen',
  'sections.menu.linkToGeology': 'Koppelen aan de stratigrafie',
  'sections.menu.unlinkFromGeology': 'Loskoppelen van de stratigrafie',
  'sections.menu.editInGeology': 'Bewerken in de stratigrafiestap',
  'sections.menu.mergeLayers': 'Lagen samenvoegen',
  // "Eenheid verwijderen" — reads distinct from the column verb "Uit dit
  // profiel verwijderen" above it in the unified menu (owner ruling 12).
  'sections.menu.removeLithoUnit': 'Eenheid verwijderen',
  'sections.menu.addSuggestionHere': 'Hier een nieuw voorstel toevoegen',
  'sections.menu.unitStatistics': 'Statistieken van deze eenheid…',
  'sections.menu.insertLayerHere': 'Hier een laag invoegen…',
  'sections.menu.editComposition': 'Samenstelling bewerken…',
  'sections.menu.splitLayer': 'Laag splitsen',
  // Accepted-layer verbs (installer #21).
  'sections.menu.splitHere': 'Hier splitsen',
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
  // Owner #35: een boringband is ook splitsbaar, op de rechtsklikdiepte (geen
  // volgende plaatsing — de klasse blijft, dus er valt niets te plaatsen).
  'sections.menu.splitBandHere': 'Band hier splitsen',
  // Owner #35: de pakkingsklassen staan nu in een submenu achter deze ene rij,
  // zodat de acties er niet meer onder wegvallen.
  'sections.menu.packingClass': 'Pakkingsklasse',
  // Geotech band-bewerkmenu — de twee "Band verwijderen"-richtingen. FLAG: niet
  // door de eigenaar geformuleerd; natuurlijke NL keuze.
  'sections.bandMenu.removeUp': 'Band verwijderen (samenvoegen met band erboven)',
  'sections.bandMenu.removeDown': 'Band verwijderen (samenvoegen met band eronder)',

  // As-titel langs het profiel. FLAG: niet door de eigenaar geformuleerd.
  'sections.axisLabel.alongM': 'Afstand langs profiel (m)',

  // Samenvoegen / Ontkoppelen van lichamen (eigenaarsbeslissing 2026-09-01) —
  // de aanwijzing tijdens het richten, de toasts en de adviezen. ``{label}`` is
  // het gerichte lichaam.
  'sections.join.armHint':
    'Bezig met samenvoegen van {label} — klik het andere lichaam · Esc annuleert',
  'sections.join.success':
    'Lichamen gegroepeerd — rechtsklik het lichaam → Ontkoppelen om ongedaan te maken.',
  'sections.join.blockedSeparation':
    'Samenvoegen geblokkeerd door een bestaande scheiding — verwijder die scheiding eerst.',
  // Twee boodschappen, gekozen op basis van of de GRONDSOORTEN verschillen
  // (eigenaarsbeslissing 2026-09-01, zijn woorden): zelfde grondsoort + andere
  // pakkingsklasse → crossPacking; andere grondsoort → crossLitho. De oude
  // crossClass / noticeCrossClass sleutels en de "{classA} en {classB}"-staart
  // zijn hier ingetrokken.
  'sections.join.crossPacking': 'Je kan twee verschillende pakkingsklassen niet samenvoegen.',
  'sections.join.crossLitho': 'Je kan twee verschillende lithologieën niet samenvoegen.',
  'sections.join.failed': 'Samenvoegen van lichamen mislukt.',
  'sections.join.noticeSame': 'Dat is hetzelfde lichaam — klik een ander om samen te voegen.',
  'sections.join.noticeUnresolvable': 'Kon dat lichaam niet herkennen — klik een gevuld lichaam.',
  'sections.unjoin.success': 'Ontkoppeld — het lichaam staat weer los.',
  'sections.unjoin.failed': 'Ontkoppelen van lichamen mislukt.',

  // ---------------------------------------------------------------------------
  // laaggrenzen
  // ---------------------------------------------------------------------------
  'sections.contacts.insertHint':
    'Klik om hier een nieuwe laag in te voegen · rechtsklik om te verwijderen',
  'sections.contacts.lithoContactHint':
    'Lithologische laaggrens — slepen verplaatst het lithomodel mee',
  'sections.contacts.coupledHint':
    'Gekoppeld aan een stratigrafische laaggrens — rechtsklik om los te koppelen',
  'sections.contacts.absorbHint':
    'Laat hier los en de band eronder wordt in deze eenheid opgenomen. Eén grens per sleepbeweging — sleep opnieuw voor de volgende.',
  'sections.contacts.absorbBlockedHint':
    'Stopt net voor de volgende lithologische laaggrens — verder gaan zou de eenheid eronder verwijderen. Verdeel die eerst onder, of bewerk ze op de litho-as.',
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
  'sections.bands.rightClickClass':
    'Rechtsklik om deze band te splitsen of de NAD-pakkingsklasse handmatig te zetten',
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
    'Een benoemde lens blijft bewaard: ze overleeft de reconciliatie van de detector en de volgende herberekening van de lichamen.',
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

  // --- P5 (sections) i18n coverage pass 2026-09-02 (builder P5). ---
  'sections.deleteContact.title': 'Laaggrens verwijderen bij {name}?',
  'sections.deleteContact.body': 'Dit kan niet ongedaan gemaakt worden. De laaggrens wordt uit het model verwijderd en afhankelijke oppervlakken worden verouderd.',
  'sections.findNoneFound': '0 gevonden',
  'sections.glyph.elevationUnknown': ' · peil onbekend',
  'sections.glyph.deep': ' · {depth} m diep',
  'sections.glyph.offLine': ' · {offset} m naast de lijn',
  'sections.glyph.clickForDetail': ' · klik voor details',
  'sections.companion.lensNamedCreated': 'Lens "{name}" aangemaakt.',
  'sections.companion.lensCreated': 'Lens aangemaakt.',
  'sections.companion.blurb': 'Een loodrecht dwarsprofiel door het zwaartepunt van de lens helpt de lensgeometrie vanuit een tweede richting na te gaan.',
  'sections.companion.yesCreate': 'Ja, profiel aanmaken',
  'sections.contacts.refContactHint': '{name} — rechtsklik om te bewerken in de stratigrafiestap',
  'sections.lithoMerge.title': 'Aangrenzende {litho}-lagen samenvoegen?',
  'sections.lithoMerge.body': 'Door die laaggrens te verwijderen liggen er nu twee {litho}-eenheden naast elkaar. Samenvoegen verwijdert de nu overbodige grens zodat ze als één doorlopende {litho}-band lezen.',
  'sections.keepSeparate': 'Apart houden',
  'sections.clampDrag.cannotMove': 'Kan niet verder — rechtsklik en verwijder eerst de aangrenzende laag, sleep dan naar de volgende grens.',
  'sections.clampDrag.packingBoundary': 'Stopt bij deze pakkingsgrens — sleep opnieuw voor de volgende.',
  'sections.copyComposition.title': 'Doelsamenstelling vervangen?',
  'sections.copyComposition.body': 'De doellaag draagt al een bewerking. Ze vervangen laat de bestaande samenstelling vallen.',
  'sections.copyComposition.from': 'Van:',
  'sections.copyComposition.toCurrently': 'Naar (nu):',
  'sections.copyComposition.replace': 'Vervangen',
  'sections.crossingTie.countOne': '{n} kruisende correlatiekoppeling',
  'sections.crossingTie.countMany': '{n} kruisende correlatiekoppelingen',
  'sections.crossingTie.labelFind': '⚠ {phrase} — klik om te zoeken',
  'sections.crossingTie.labelResolve': '⚠ {phrase} — los op om de banden te herstellen',
  'sections.crossingTie.aria': '{phrase}. Activeer om de volgende te centreren.',
  'sections.lens.candidateEither': 'Mogelijke lens — geen correlatie met een van beide buren. Wig ze uit in plaats van ze te correleren.',
  'sections.lens.pinchOutCandidateFull': 'Mogelijke uitwigging — deze laag wigt uit naar de buur toe, zodat de kruisende correlatie niet getekend werd. De 2/1/0-vulling tekent ze automatisch als lens.',
  'sections.lens.styleStraight': 'recht',
  'sections.lens.styleBlocky': 'blokkig',
  'sections.lens.styleRounded': 'afgerond',
  // FLAG alt: reconciliatie | herafstemming | reconcile — "reconcile" is the detector's technical resweep; no settled NL term.
  'sections.nameBody.keptHint': 'Een benoemde lens blijft bewaard: ze overleeft de reconciliatie van de detector en de volgende herberekening van de lichamen.',
  'sections.nameBody.placeholder': 'bv. Zandlens — kaai 7',
  'sections.lensPanel.bodyLabel': 'Lichaam',
  'sections.lensPanel.confirming': 'Bevestigen…',
  'sections.lensPanel.confirmAllAuto': 'Alle auto bevestigen ({count})',
  'sections.lensPanel.saving': 'Opslaan…',
  'sections.lensPanel.saveNameFirst': 'Sla eerst een lensnaam op',
  'sections.lensPanel.companionHint': 'Maak automatisch een loodrecht begeleidend dwarsprofiel door het zwaartepunt van de lens',
  'sections.moveRestated.titleGeo': 'Contact, litho en stratigrafie verplaatsen?',
  'sections.moveRestated.titleLitho': 'Contact en litho verplaatsen?',
  'sections.moveRestated.body': 'Deze grens is een lithologische laaggrens, geen pakkingsgrens. Ze naar {depth} m verplaatsen verandert meer dan alleen het geotechnisch model.',
  'sections.moveRestated.bullet1': 'de twee pakkingsbanden aan weerszijden — beide leiden hun NAD-klasse opnieuw af, omdat hun dieptebereik veranderd is en dus ook de qc erover',
  'sections.moveRestated.bullet2': 'de lithologische laaggrens die ze herhaalt',
  'sections.moveRestated.bullet3': 'de stratigrafische laaggrens waarvan deze eenheid is afgeleid — alle drie in één schrijfactie, zodat ze achteraf niet met elkaar in tegenspraak kunnen zijn',
  'sections.moveRestated.undoNote': 'Één stap op de ongedaan-maken-stapel. Ctrl+Z zet alles terug.',
  'sections.moveRestated.moveIt': 'Verplaatsen',
  'sections.flaggedTies.titleOne': '{count} correlatie komt niet meer overeen',
  'sections.flaggedTies.titleMany': '{count} correlaties komen niet meer overeen',
  'sections.flaggedTies.body1One': 'De pakkingsklasse is aan één zijde van deze koppeling veranderd, zodat de twee uiteinden niet langer dezelfde ondergrond beschrijven.',
  'sections.flaggedTies.body1Many': 'De pakkingsklasse is aan één zijde van deze koppelingen veranderd, zodat de twee uiteinden niet langer dezelfde ondergrond beschrijven.',
  'sections.flaggedTies.body2One': 'Ze wordt bewaard en gemarkeerd voor nazicht — er is niets verloren. Verwijder ze alleen als de correlatie zelf fout was; behoud ze als de twee kolommen nog samen horen en de klasse nog een blik nodig heeft.',
  'sections.flaggedTies.body2Many': 'Ze worden bewaard en gemarkeerd voor nazicht — er is niets verloren. Verwijder ze alleen als de correlatie zelf fout was; behoud ze als de twee kolommen nog samen horen en de klasse nog een blik nodig heeft.',
  'sections.flaggedTies.body3': 'Verwijderen is één stap op de ongedaan-maken-stapel. Zolang een afwijkende koppeling op nazicht wacht, voegt ze haar twee banden niet tot één lichaam samen, dus het 3D-model last ze hoe dan ook niet aaneen.',
  'sections.flaggedTies.deleteOne': 'Verwijder ze',
  'sections.flaggedTies.deleteMany': 'Verwijder ze',
  'sections.sampleLabel': 'Monster {n}',
  'sections.sampleGeotech.ariaClickable': 'Monster {label} — klik om het lichaam te markeren',
  'sections.sampleGeotech.tooltip': 'Monster {label}\\n{top}–{base} m{tail}',
  'sections.psd.organic': 'organisch {quantity} {pct} %',
  'sections.header.lengthBuffer': '{length} m · buffer ±{buffer} m',
  'sections.header.companionTitleActive': 'Dit profiel is automatisch aangemaakt als loodrecht begeleidend profiel voor een litholens',
  'sections.header.companionTitleDeleted': 'Dit profiel was een lensbegeleider (de lens is intussen verwijderd)',
  'sections.header.companionOf': 'loodr · Begeleider van {name}',
  'sections.header.lensCompanion': 'loodr · Lensbegeleidingsprofiel',
  'sections.header.bufferHint': 'Loodrechte afstand tot de profiellijn waarbinnen grondonderzoek erop geprojecteerd wordt',
  'sections.header.buffer': 'Buffer',
  'sections.header.channels': 'Kanalen',
  'sections.header.toggle': 'Schakel {label}',
  // FLAG alt: Boring | Bore — compact toggle label for the borehole interpretation streams.
  'sections.header.bore': 'Boring',
  'sections.header.snapHint': 'Indien aan klikt het plaatsen op een boring de laaggrensdiepte vast op de dichtstbijzijnde formele / informele stratigrafiegrens (binnen 8 px)',
  // "Snap" verbatim — the tutorial calls it the Snap-knop, and BE geotech
  // practice keeps the English term (owner ruling 5, 2026-09-06). Recorded as
  // intentionally identical to EN in localeParity's allow-list.
  'sections.header.snap': 'Snap',
  // FLAG alt: Afstand | Kolomafstand — compact slider label (full term is Kolomafstand elsewhere).
  'sections.header.spacing': 'Afstand',
  'sections.header.scaleH': 'H: {scale} px/m',
  'sections.header.scaleV': 'V: {scale} px/m',
  'sections.inspector.lengthEpsg': '{length} m · EPSG:{epsg}',
  'sections.focusLabel': 'Focus op {name}',
  'sections.emptyContacts.hintSeed': 'Klik op \'Vullen\' in de werkbalk om te vullen vanuit het actieve model, of teken de laaggrenzen handmatig.',
  'sections.emptyContacts.hintDefine': 'Definieer eerst formaties in de stratigrafiestap, kom dan hier terug om te vullen of laaggrenzen handmatig te tekenen.',
  'sections.hiddenFooter.count': '{n} verborgen op dit profiel',
  'sections.hiddenFooter.restoreAll': 'alles herstellen',
  'sections.scrub.showing': 'Toont {shown} m van {total} m (databereik)',
  'sections.staleColumn.title': '{name}: pakking afgeleid van een oudere lithologie op deze proef. Druk op Onderverdelen om ze opnieuw af te leiden.',
  'sections.vb.depthHint': 'Toon lagen tot N meter onder het maaiveld van elk grondonderzoek. Leeg = volledige DOV-kolom.',
  'sections.vb.showOnSection': 'Op profiel tonen',
  'sections.vb.modelSlot': 'Model {label}',
  'sections.vb.noOverlay': 'Geen overlay in dit vak',
  'sections.ghost.copyChip': 'Kopieer {litho}',
  'sections.geotech.qcLabel': 'qc: {statistic}',
  // De vier representatieve qc-statistieken zoals de gebruiker ze leest
  // (eigenaar 2026-09-13). Het token op de lijn blijft Engels; alleen de
  // weergave is vertaald.
  'sections.geotech.statisticName.median': 'mediaan',
  'sections.geotech.statisticName.arithmetic': 'rekenkundig',
  'sections.geotech.statisticName.harmonic': 'harmonisch',
  'sections.geotech.statisticName.geometric': 'meetkundig',
  'sections.bands.dragMoveHint': 'Sleep om deze pakkingsgrens te verplaatsen · rechtsklik om de banden samen te voegen',
  'sections.bands.rightClickMerge': 'Rechtsklik om deze twee pakkingsbanden samen te voegen',
  'sections.bands.placeReadout': '{depth} m — klik om te plaatsen, Esc om te annuleren',
  'sections.bands.mergeReadout': 'laat los om samen te voegen met de band {dir} — klasse opnieuw afgeleid over de vereniging',
  'sections.bands.dirBelow': 'eronder',
  'sections.bands.dirAbove': 'erboven',
  'sections.bands.moveReadout': '{depth} m — laat los om te verplaatsen, Esc om te annuleren',
  'sections.bands.currentSuffix': ' (huidig)',
  // De "(huidig: X)"-markering op de "Pakkingsklasse ▸"-submenurij (owner #35).
  'sections.bands.packingClassCurrent': '(huidig: {label})',
  'sections.bands.toast.splitHere': 'Band gesplitst.',
  'sections.bands.foreignClassSuffix': ' (huidig — een {family}-klasse op deze grondsoort)',
  'sections.bandDialog.moveTitle': 'Deze pakkingsgrens verplaatsen?',
  'sections.bandDialog.mergeTitle': 'Deze pakkingsbanden samenvoegen?',
  'sections.bandDialog.splitTitle': 'Deze pakkingsband splitsen?',
  'sections.bandDialog.rederiveBlurb': 'De pakkingsklasse wordt opnieuw afgeleid uit de conusweerstand over elk resulterend interval, binnen het litholichaam op {range}. Alleen deze kolom wordt opnieuw afgeleid.',
  'sections.bandDialog.unchanged': '(ongewijzigd)',
  'sections.bandDialog.representativeQc': 'Representatieve qc{statistic} {value} MPa',
  'sections.bandDialog.sameClass': 'De conusweerstand geeft hoe dan ook dezelfde pakkingsklasse — deze bewerking verandert de grens, niet de classificatie.',
  'sections.bandDialog.needsReview': 'nazicht nodig',
  // FLAG alt: klasse {n} | NAD-klasse {n} — borders the NAD domain-canon carve-out; "class" is a UI label here, the number is the NAD class.
  'sections.bandDialog.classLabel': 'klasse {n}',
  'sections.bandDialog.verbMove': 'Grens verplaatsen',
  'sections.bandDialog.verbMerge': 'Banden samenvoegen',
  'sections.bandDialog.verbSplit': 'Band splitsen',
  'sections.toast.loadFailed': 'Laden van dwarsprofielen mislukt.',
  'sections.toast.noCrs': 'Geen coördinatensysteem gevonden. Importeer grondonderzoek of stel eerst een standaard horizontaal CRS in bij de projectmetadata.',
  'sections.toast.sameEndpoints': 'De twee eindpunten vielen op hetzelfde punt. Probeer opnieuw.',
  'sections.toast.createFailed': 'Kon het dwarsprofiel niet aanmaken.',
  'sections.toast.deleteFailed': 'Kon het dwarsprofiel niet verwijderen.',
  'sections.toast.saveFailed': 'Kon de profielwijziging niet opslaan.',
  'sections.toast.contactNotFound': 'Kon de laaggrens in het huidige project niet vinden.',
  'sections.toast.noCleanTies': 'Geen zuivere koppelprofielen gevonden — verruim de tolerantie in de instellingen.',
  'sections.toast.tieCreateFailed': 'Kon het koppelprofiel niet aanmaken.',
  'sections.toast.tiesCreateFailed': 'Kon de koppelprofielen niet aanmaken.',
  'sections.toast.contactDepthUpdateFailed': 'Kon de diepte van de laaggrens niet bijwerken.',
  'sections.toast.contactMoveFailed': 'Kon de bestaande laaggrens niet naar de nieuwe diepte verplaatsen.',
  'sections.toast.contactPlaceFailed': 'Kon de formatiegrens niet plaatsen.',
  'sections.toast.copiedSomeFailed': 'Gekopieerd: {total} laaggrens(en); {failed} mislukt — sommige ontbreken mogelijk.',
  'sections.toast.contactsUpdateFailed': 'Kon de geselecteerde laaggrenzen niet bijwerken.',
  'sections.toast.contactDeleteFailed': 'Kon de laaggrens niet verwijderen.',
  'sections.toast.unlinkFailed': 'Kon de laaggrens niet loskoppelen van de stratigrafie.',
  'sections.toast.noGeoInTolerance': 'Geen stratigrafische laaggrens binnen de kliktolerantie om aan te koppelen.',
  'sections.toast.linkFailed': 'Kon de laaggrens niet aan de stratigrafie koppelen.',
  'sections.toast.correlationAdded': 'Correlatie toegevoegd — er vormt zich een wig wanneer ze de laag overspant.',
  'sections.toast.correlationCreateFailed': 'Kon de correlatie niet aanmaken — probeer opnieuw.',
  'sections.toast.edgeRetargeted': 'Rand opnieuw gericht.',
  'sections.toast.edgeRetargetFailed': 'Kon de rand niet opnieuw richten — probeer opnieuw.',
  'sections.scope.allSections': 'op alle profielen',
  'sections.scope.thisSection': 'op dit profiel',
  'sections.geotechCorr.nothingNew': 'Automatisch correleren {scope}: niets nieuws — alle {n} automatische koppeling(en) zijn al gecorreleerd.',
  'sections.geotechCorr.noTies': 'Automatisch correleren {scope}: geen automatische pakkingskoppelingen gevonden — verdeel eerst de lichamen onder.',
  'sections.geotechCorr.result': 'Automatisch correleren {scope}: {accepted} {accWord} gebandeerd, {proposed} nieuwe {propWord} voorgesteld, {skipped} ongemoeid gelaten{tail}',
  'sections.geotechCorr.accWordOne': 'litho-gedekte koppeling',
  'sections.geotechCorr.accWordMany': 'litho-gedekte koppelingen',
  'sections.geotechCorr.propWordOne': 'pakkingskoppeling',
  'sections.geotechCorr.propWordMany': 'pakkingskoppelingen',
  'sections.geotechCorr.resultTailReview': ' — bekijk de ghosts en dan "3 · Koppelingen aanvaarden".',
  'sections.geotechCorr.autoFailed': 'Pakking automatisch correleren mislukt — zie de console.',
  'sections.geotechCorr.acceptFailed': 'Pakkingscorrelaties aanvaarden mislukt — zie de console.',
  'sections.geotechCorr.noPending': 'Geen openstaande pakkingscorrelaties om te aanvaarden {scope}.',
  'sections.geotechCorr.accepted': '{n} {word} aanvaard {scope}.',
  'sections.geotechCorr.packingCorrOne': 'pakkingscorrelatie',
  'sections.geotechCorr.packingCorrMany': 'pakkingscorrelaties',
  'sections.bandEdit.splitPlanFailed': 'Kon niet bepalen wat die splitsing zou doen — probeer opnieuw.',
  'sections.bandEdit.mergePlanFailed': 'Kon niet bepalen wat die samenvoeging zou doen — probeer opnieuw.',
  'sections.bandEdit.movePlanFailed': 'Kon niet bepalen wat die verplaatsing zou doen — probeer opnieuw.',
  'sections.bandEdit.absorbPlanFailed': 'Kon niet bepalen wat die opname zou doen — probeer opnieuw.',
  'sections.bandEdit.classSet': 'Klasse ingesteld op NAD {nadClass}.',
  'sections.bandEdit.classSetFlagged': 'Klasse ingesteld op NAD {nadClass}; {flagged} {word} gemarkeerd voor nazicht.',
  'sections.bandEdit.acceptedTieOne': 'aanvaarde koppeling',
  'sections.bandEdit.acceptedTieMany': 'aanvaarde koppelingen',
  'sections.bandEdit.setClassFailed': 'Kon de klasse niet instellen — probeer opnieuw.',
  'sections.bandEdit.cleared': '{n} {word} gewist op {name} — druk op 1 (sondering) of 4 (boring) om ze opnieuw op te bouwen.',
  'sections.bandEdit.bandWordOne': 'band',
  'sections.bandEdit.bandWordMany': 'banden',
  'sections.bandEdit.clearFailed': 'Kon de onderverdeling niet wissen — probeer opnieuw.',
  'sections.bandEdit.savedNotRefreshed': 'De bewerking is opgeslagen, maar de correlaties op het scherm konden niet ververst worden — heropen het profiel voor je de koppelingen beoordeelt.',
  'sections.bandEdit.applyFailed': 'Kon de bewerking niet toepassen — probeer opnieuw.',
  'sections.packingCorr.added': 'Pakkingscorrelatie toegevoegd.',
  'sections.packingCorr.disconnectFailed': 'Kon de banden niet loskoppelen — de koppeling staat er nog. Probeer opnieuw.',
  'sections.packingCorr.acceptFailed': 'Kon de pakkingscorrelatie niet aanvaarden. Probeer opnieuw of ververs.',
  'sections.packingCorr.confirmFailed': 'Kon de koppeling niet bevestigen. Probeer opnieuw of ververs.',
  'sections.stat.setBuild': 'Representatieve statistiek ingesteld op {statistic} — gebruik "1 · Sonderingen onderverdelen" om de pakkingsbanden eronder op te bouwen.',
  'sections.stat.setReclassify': 'Representatieve statistiek ingesteld op {statistic} — gebruik "1 · Sonderingen onderverdelen" om de banden eronder te herclassificeren.',
  'sections.stat.set': 'Representatieve statistiek ingesteld op {statistic}.',
  'sections.lithoCorr.precheckFailed': 'Voorcontrole automatisch correleren mislukt — zie de console.',
  'sections.lithoCorr.cleared': '{n} {word} gewist; opnieuw uitvoeren…',
  'sections.lithoCorr.autoEdgeOne': 'automatische rand',
  'sections.lithoCorr.autoEdgeMany': 'automatische randen',
  'sections.lithoCorr.reCorrelateFailed': 'Opnieuw correleren mislukt — zie de console.',
  'sections.lithoCorr.accepted': '{n} {word} aanvaard.',
  'sections.lithoCorr.correlationOne': 'correlatie',
  'sections.lithoCorr.correlationMany': 'correlaties',
  'sections.lithoCorr.acceptFailed': 'Aanvaarden mislukt — probeer opnieuw.',
  'sections.snap.failed': 'Vastklikken mislukt: {message}',
  'sections.snap.moved': 'Stratigrafische laaggrens verplaatst; oppervlakken herbouwd.',
  'sections.snap.moveFailed': 'Verplaatsen mislukt: {message}',
  'sections.canvas.newSectionTitle': 'Een nieuw dwarsprofiel aanmaken met voorlopige eindpunten',
  'sections.canvasToast.admixturesUpdated': 'Bijmengingen bijgewerkt op {n} {word}.',
  'sections.canvasToast.correlatedUnitOne': 'gecorreleerde eenheid',
  'sections.canvasToast.correlatedUnitMany': 'gecorreleerde eenheden',
  'sections.canvasToast.admixturesFailed': 'Kon de bijmengingen van het lichaam niet bijwerken — probeer opnieuw.',
  'sections.canvasToast.lensShapeFailed': 'Kon de lensvorm niet opslaan — zie de console.',
  'sections.canvasToast.boundaryCorrAdded': 'Grenscorrelatie toegevoegd.',
  'sections.canvasToast.boundaryCorrFailed': 'Kon de grenscorrelatie niet aanmaken — probeer opnieuw.',
  'sections.canvasToast.acceptCorrFailed': 'Kon de correlatie niet aanvaarden. Probeer opnieuw of ververs.',
  'sections.canvasToast.bodyNamed': 'Lichaam benoemd: {name}',
  'sections.canvasToast.bodyNameFailed': 'Lichaam benoemen mislukt.',
  'sections.canvasToast.dissolveConfirm': 'Dit lichaam ontbinden? Dit verwijdert het lichaam en zijn uitbreidingsgegevens.',
  'sections.canvasToast.bodyDissolved': 'Lichaam ontbonden.',
  'sections.canvasToast.bodyDissolveFailed': 'Lichaam ontbinden mislukt.',
  // Accepted-layer edit / split (installer #21).
  'sections.canvasToast.compositionUpdated': 'Samenstelling van de laag bijgewerkt: {composition}.',
  'sections.canvasToast.compositionUpdateFailed': 'Kon de samenstelling van de laag niet bijwerken — probeer opnieuw.',
  'sections.canvasToast.layerSplit': 'Laag gesplitst.',
  'sections.canvasToast.layerSplitFailed': 'Kon de laag niet splitsen — het splitspunt ligt mogelijk te dicht bij een grens.',
  // Shift-slepen van een geaccepteerd litho-contact naar een andere test (installer #35).
  'sections.canvasToast.lithoContactCopied': 'Litho-contact gekopieerd: beide eenheden aangemaakt.',
  'sections.canvasToast.lithoBoundaryCopied': 'Grens gekopieerd, samenstellingen behouden.',
  // Shift-slepen van meerdere grenzen (installer #40): beide aantallen gemeld.
  'sections.canvasToast.lithoContactsCopiedOneUnit': '{boundaries} grenzen en 1 eenheid gekopieerd.',
  'sections.canvasToast.lithoContactsCopiedManyUnits': '{boundaries} grenzen en {units} eenheden gekopieerd.',
  'sections.canvasToast.lithoContactCopyBelowTerminal': 'De grens ligt onder de diepte van deze test en is niet gekopieerd.',
  // Shift-slepen naar een ONDIEPE test (een CPTM): de passende eenheden landen, de
  // diepere grenzen worden weggeknipt (owner 2026-09-16). Toegevoegd aan de succestoast.
  'sections.canvasToast.lithoContactCopyClippedOne': '1 grens ligt onder de diepte van deze test en is weggelaten.',
  'sections.canvasToast.lithoContactCopyClippedMany': '{dropped} grenzen liggen onder de diepte van deze test en zijn weggelaten.',
  'sections.canvasToast.lithoContactCopyFailed': 'Kon het litho-contact niet kopiëren. Probeer opnieuw.',
  'sections.canvasToast.noLithoContact': 'Deze grens heeft geen lithologische laaggrens om te verplaatsen — bewerk ze op de litho-as.',
  'sections.canvasToast.packingNotLithoCpt': 'Dat is een pakkingsgrens, geen lithologische laaggrens — sleep ze met de greep naast de kolom.',
  'sections.canvasToast.packingNotLithoBorehole': 'Dat is een pakkingsgrens, geen lithologische laaggrens. De pakkingsbanden van een boring zijn geëxtrapoleerd uit de sonderingen eromheen, dus ze kunnen hier niet verplaatst worden.',
  'sections.canvasToast.perpCreated': 'Loodrecht profiel aangemaakt.',
} as const
