// De drie modelstappen — geologisch, lithostratigrafisch, geotechnisch.
//
// Part of the Dutch (BE) message catalogue — see 'locales/nl/index.ts'.

export const MODELS_NL = {
  // -------------------------------------------------------------------------
  // geologie
  // -------------------------------------------------------------------------
  'geology.formations': 'Formaties',
  'geology.addFormation': 'Formatie toevoegen',
  'geology.addFormationHint': 'Voeg een nieuwe formatie toe aan dit project',
  'geology.createFormation': 'Formatie aanmaken',
  'geology.editFormation': 'Formatie bewerken',
  'geology.deleteFormation': 'Formatie verwijderen',
  'geology.deleteFormationConfirm': 'Formatie verwijderen?',
  'geology.recolorFormation': 'Kleur van de formatie wijzigen',
  'geology.newFormation': 'Nieuwe formatie',
  'geology.newFormationHint':
    'Maak een voorlopige formatie aan — hernoem en herkleur ze in het detailvenster',
  'geology.reorderHint': 'Sleep om de volgorde te wijzigen (lager = ouder)',
  'geology.dropAtBottom': 'Laat hier los om onderaan te plaatsen (oudste)',
  'geology.fillFromBoreholes': 'Vullen vanuit boringen',
  // NOTE: ruled 2026-08-27 — owner chose "3D-model bouwen".
  'geology.build3d': '3D-model bouwen',
  'geology.activeStratigraphy':
    'Actieve stratigrafie — elke formatiekeuze hoort bij dit model',
  'geology.boreholesInModel': 'Boringen in het model',
  'geology.showBoreholeScopes': 'Toon / verberg de schakelaars per boring',
  'geology.showConfidenceFade': 'Betrouwbaarheidsvervaging tonen',
  'geology.confidenceFadeHint':
    'Vervaagde driehoeken in de 3D-weergave en vervaagde contactlijnen op profielen markeren zones waar de TIN extrapoleert, weg van nabije gegevens. Zet dit uit voor een egale kleur.',
  'geology.groundSurface': 'Maaiveld',
  'geology.deleteModelConfirm': 'Geologisch model verwijderen?',
  'geology.deleteStratigraphy': 'Stratigrafie verwijderen…',
  'geology.dedupeContacts': 'Dubbele laaggrenzen opschonen…',
  'geology.addToModel': 'Aan het model toevoegen',
  'geology.overwriteModel': 'Model overschrijven',
  'geology.addOrReplace': 'Toevoegen aan dit model, of het vervangen?',
  'geology.emptyNoBoreholes':
    'Nog geen formaties. Dit project bevat geen boringen om uit te vullen — voeg handmatig een formatie toe om het model te starten.',
  'geology.emptyWithBoreholes':
    'Nog geen formaties. Gebruik "Vullen vanuit boringen" in de werkbalk om ze uit de boorstratigrafie te halen, of voeg er handmatig een toe.',
  'geology.noStratigraphyOnSection':
    'Geen enkele boring op dit profiel bevat stratigrafiegegevens.',
  'geology.noInterpretationData':
    'Geen enkele boring bevat interpretatiegegevens — voeg de formaties handmatig toe in het detailvenster.',
  'geology.surfaceCrossingWarnings': 'Waarschuwingen over kruisende vlakken',
  'geology.surfaceValidationFailed': 'Validatie van de vlakken mislukt',
  'geology.surfaceValidationPending': 'Validatie van de vlakken nog niet uitgevoerd',
  'geology.openOffendingSection':
    'Open het dwarsprofiel met de betrokken laaggrenzen en verschuif ernaartoe.',
  'geology.noSectionForContact':
    'Geen enkel dwarsprofiel bevat de betrokken laaggrens — teken er een door de boring of sondering om ze te bekijken.',
  'geology.loadFailed':
    'Kon het geologisch model niet laden — controleer de verbinding en open het project opnieuw.',
  'geology.splitView': 'Gesplitste weergave',
  'geology.singleView': 'Eén weergave',
  'geology.singleViewHint': 'Terug naar één weergave',
  'geology.drawSplitLine':
    'Teken een lijn over het model om het te splitsen in twee weergaven die je apart kan verschuiven',
  'geology.cancelSplit': 'Splitsen annuleren',
  'geology.cancelSplitHint': 'Annuleer het tekenen van de splitsingslijn',
  'geology.reset3dView': '3D-weergave herstellen',
  'geology.offlineBasemap':
    'Offline — achtergrondkaart niet beschikbaar. De geometrie van de formaties is niet aangetast.',
  // 3-D LAGEN-legende.
  'geology.layers': 'Lagen',
  'geology.basemap': 'Achtergrondkaart',
  'geology.hideBasemap': 'Achtergrondkaart verbergen',
  'geology.showBasemap': 'Achtergrondkaart tonen',
  'geology.hideGroundSurface': 'Maaiveld verbergen',
  'geology.showGroundSurface': 'Maaiveld tonen',
  'geology.showIn3d': 'Tonen in 3D',
  'geology.hideIn3d': 'Verbergen in 3D',
  'geology.thisModel': 'Dit model',
  'geology.splitModel': 'Model splitsen',
  'geology.drawSplitFirst': 'Klik twee punten om een splitsingslijn te tekenen',
  'geology.drawSplitSecond': 'Klik het tweede punt om de splitsingslijn te voltooien',
  'geology.compareWith': 'Vergelijk met {label}',
  'geology.compareWithHint': 'Toon {label} naast dit model op hetzelfde standpunt',
  // GeotechLagen-boom — de geneste bodem ▸ klasse ▸ lichaam-legenderijen.
  'geology.collapseNamed': '{label} inklappen',
  'geology.expandNamed': '{label} uitklappen',
  'geology.showNamedIn3d': '{label} tonen in 3D',
  'geology.hideNamedIn3d': '{label} verbergen in 3D',
  'geology.showBodyIn3d': 'Lichaam {label} tonen in 3D',
  'geology.hideBodyIn3d': 'Lichaam {label} verbergen in 3D',
  // NOTE: ruled 2026-08-27 — owner chose "Lichaam met te weinig gegevens".
  'geology.underConstrainedBody': 'Lichaam met te weinig gegevens',
  'geology.switchBasemap': 'Achtergrondkaart wisselen',
  'geology.formationCandidates': 'Kandidaat-formaties',
  'geology.targetFormationOptions': 'Opties voor doelformatie',
  'geology.keepSeparate': 'Apart houden',
  'geology.applySelection': 'Selectie toepassen',
  // NOTE: ruled 2026-08-27 — owner chose "Samenvoegconflicten".
  'geology.lumpingCollisions': 'Samenvoegconflicten',
  'geology.selectFormationsBlurb':
    'Selecteer de formaties die je wil opnemen. Gebruik "→ zelfde als" op een regel om ze bij een andere te voegen.',
  'geology.filterFormationPlaceholder': 'Filter of typ de naam van een doelformatie',
  'geology.rerankPlaceholder': 'Typ om te herordenen of geef een naam in…',
  'geology.noStratigraphyCandidates': 'Geen kandidaten uit de stratigrafie gevonden.',
  // geologie-werkbalk + dialoogvensters
  'geology.scanning': 'Scannen…',
  'geology.applying': 'Toepassen…',
  'geology.building': 'Bouwen…',
  'geology.cleaning': 'Opschonen…',
  'geology.deleting': 'Verwijderen…',
  'geology.noBoreholesVisible': 'Geen boringen zichtbaar in dit project',
  'geology.scanningStratigraphy': 'Boorstratigrafie scannen…',
  'geology.applyingSelection': 'Selectie toepassen…',
  'geology.fillTitle':
    'Ontdek formatienamen uit de boorstratigrafie en kies welke je behoudt',
  'geology.buildStale': '3D-model bouwen · {n} verouderd',
  'geology.buildNoModel': 'Geen actieve stratigrafie — maak eerst formaties en laaggrenzen aan',
  'geology.buildNoContacts':
    'Nog geen laaggrenzen — open een dwarsprofiel, zaai dan vanuit de stratigrafie op de geologie-as of kies handmatig laaggrenzen voor je bouwt',
  'geology.building3d': '3D-model bouwen…',
  'geology.surfacesNeedRebuildOne':
    '{n} formatie-oppervlak moet herbouwd worden — klik om TIN’s te berekenen',
  'geology.surfacesNeedRebuildMany':
    '{n} formatie-oppervlakken moeten herbouwd worden — klik om TIN’s te berekenen',
  'geology.rebuildTins': 'Herbouw TIN-oppervlakken op basis van de huidige laaggrenzen',
  'geology.dedupe': 'Ontdubbelen',
  'geology.noActiveStratigraphy': 'Geen actieve stratigrafie',
  'geology.dedupeTitle':
    'Verwijder dubbele (anker, formatie) laaggrenzen — behoudt de meest recente keuze in elke groep',
  'geology.resetView': 'Weergave herstellen',
  'geology.resetViewTitle':
    'Terug naar één 3D-weergave en vlieg de camera naar het omhullende kader van het model',
  'geology.deleteStratigraphyShort': 'Stratigrafie verwijderen',
  'geology.deleteStratigraphyTitle':
    'Verwijder definitief het actieve geologische model en al zijn formaties, laaggrenzen en oppervlakken',
  'geology.moreActions': 'Meer geologie-acties',
  'geology.applyFailed': 'Kon de formatieselectie niet toepassen — controleer de verbinding.',
  'geology.deleteFailed': 'Kon het model niet verwijderen.',
  'geology.selectionExcludePrefix': 'Je selectie mist',
  'geology.selectionExcludeSuffix': 'die al in dit model zitten.',
  'geology.unitWordOne': 'eenheid',
  'geology.unitWordMany': 'eenheden',
  'geology.unitCount': '{n} {unit}',
  'geology.addToModelExplain': 'behoudt ze en voegt enkel toe wat je geselecteerd hebt.',
  'geology.overwriteExplainPrefix': 'verwijdert definitief {n} {unit} die niet in je selectie zitten:',
  'geology.overwriteExplainSuffix': 'en elk contact erop.',
  'geology.deleteModelBody':
    'en al zijn formaties, laaggrenzen en opgeslagen oppervlakken worden permanent verwijderd. Dit kan niet ongedaan gemaakt worden.',
  'geology.deleteModelButton': 'Geologisch model verwijderen',

  // -------------------------------------------------------------------------
  // lithostratigrafie
  // -------------------------------------------------------------------------
  'litho.model': 'Lithologiemodel',
  'litho.modelFull': 'Lithostratigrafisch model',
  'litho.units': 'Lithologische eenheden',
  'litho.unitsStale': 'Lithologische eenheden — het 3D-model is verouderd, bouw het opnieuw op',
  'litho.formations': 'Litho-formaties',
  // FLAG alt: Vaste lichamen | Solids — "body solid" is the closed 3D volume
  // the build produces. CAD-NL commonly leaves "solid" untranslated.
  'litho.bodySolids': 'Lichamen (3D)',
  'litho.noModel': 'Geen lithologiemodel',
  'litho.noUnits': 'Nog geen lithologische eenheden in dit model',
  // FLAG alt: Niet meer actueel | Achterhaald — badge text, must stay short.
  'litho.stale': 'Verouderd',
  'litho.staleHint': 'Verouderd — bouw opnieuw op om bij te werken',
  'litho.createModel': 'Lithostratigrafisch model aanmaken',
  'litho.createModelHint':
    'Maak het lithostratigrafisch model aan dat dit geologisch model verfijnt',
  'litho.newModel': 'Nieuw lithostratigrafisch model',
  'litho.newModelHint':
    'Nieuw lithostratigrafisch model (verfijnt het actieve geologisch model)',
  'litho.newModelNameLabel': 'Naam van het nieuwe lithostratigrafisch model',
  'litho.modelNamePlaceholder': 'Modelnaam…',
  'litho.activeModel': 'Actief lithostratigrafisch model',
  'litho.deleteModel': 'Lithostratigrafisch model verwijderen',
  'litho.deleteModelConfirm': 'Lithostratigrafisch model verwijderen?',
  'litho.deleteModelHint': 'Verwijder het actieve lithostratigrafisch model',
  'litho.cancelNewModel': 'Nieuw model annuleren',
  'litho.createOneToPick': 'Maak er een aan om laaggrenzen op profielen te kunnen kiezen',
  'litho.clearModel': 'Alle litho-inhoud van dit model wissen',
  'litho.clearModelConfirm': 'Lithomodel wissen?',
  'litho.emptyInspector':
    'Aanvaard voorstellen uit de sonderingen of teken laaggrenzen op een profiel — elke aanvaarde laag voegt hier een eenheid toe.',
  'litho.emptyCanvas':
    'Kies of maak een lithologiemodel in het rechterpaneel. Teken laaggrenzen in de profielstap en klik daarna op Model bouwen in de lithologiewerkbalk om de 3D-lichamen te genereren.',
  'litho.createThenSections':
    'Maak hierboven een lithologiemodel aan en open daarna de profielstap om laaggrenzen te tekenen.',
  'litho.drawThenBuild':
    'Teken laaggrenzen op de profielen en bouw daarna opnieuw op om de vlakken bij te werken.',
  'litho.buildToSeeBodies': 'Bouw het 3D-model op om de lichamen te zien.',
  'litho.allContentBlurb':
    'Alle litho-eenheden, laaggrenzen, correlaties en vlakken in dit model',
  'litho.renumberBodies': 'Litholichamen hernummeren op basis van hun correlatiegrafiek',
  'litho.pickBodyColour': 'Kies een eigen kleur voor dit lichaam',
  'litho.resetBodyColour': 'Terug naar de lithologiekleur van de formatie',
  'litho.underConstrained':
    'Onvoldoende bepaald: minder dan 3 sondeer-/boortrajecten — benaderende plaat',
  'litho.confidenceFadeHint':
    'Vervaagde driehoeken in de 3D-weergave markeren zones waar het model extrapoleert, weg van nabije gegevens. Zet dit uit voor een egale kleur.',
  'litho.parentFormation': 'Bovenliggende geologische formatie',
  'litho.noParent': '— Geen bovenliggende formatie (losmaken) —',
  // NOTE: ruled 2026-08-27 — owner chose "Hekkendiagram".
  'litho.switchSolidFence': 'Hekkendiagram',
  // NOTE: ruled 2026-08-27 — owner chose "Hekkendiagram exporteren".
  'litho.exportFence': 'Hekkendiagram exporteren',
  'litho.exportFenceHint':
    'Bewaar de 3D-profielwand als DXF (zet de weergave eerst op hekkendiagram)',
  'litho.resetCamera': 'Camera herstellen',
  'litho.resetCameraHint':
    'Klap elke gesplitste weergave dicht en breng de camera terug naar het volledige model',
  'litho.nothingToBuild':
    'Niets om op te bouwen — aanvaard eerst litholagen op een dwarsprofiel en bouw daarna op.',
  'litho.nothingToExportFence':
    'Niets om te exporteren — zet de 3D-weergave op Hekkendiagram en zorg dat de wand vlakken bevat.',
  'litho.autoCorrelateNothing':
    'Autocorrelatie: geen correleerbare eenheden gevonden — aanvaard eerst de lithovoorstellen.',
  // dialoog bevestigen / opnieuw toewijzen / losmaken bovenliggende formatie
  'litho.assignParent': 'Bovenliggende formatie toewijzen',
  'litho.confirmExtrapolatedParent': 'Geëxtrapoleerde bovenliggende formatie bevestigen',
  'litho.orphanBlurb': 'Geen geologische laaggrens dekte deze litho-eenheid bij het onderzoek.',
  'litho.extrapolatedBlurb':
    'De bovenliggende formatie is afgeleid uit de geologie-TIN — bevestig of wijzig ze.',
  'litho.detach': 'Losmaken',
  'litho.confirm': 'Bevestigen',
  'litho.reassign': 'Opnieuw toewijzen',
  // model-keuzerij
  'litho.newShort': 'Nieuw',
  'litho.selectPlaceholder': '— selecteer —',
  'litho.thisModelFallback': 'Dit model',
  'litho.deleteModelBody':
    'en al zijn formaties, laaggrenzen en opgeslagen oppervlakken worden permanent verwijderd. De geologische bovenliggende formatie blijft ongemoeid. Dit kan niet ongedaan gemaakt worden.',
  // lithologie-werkbalk (Model bouwen / hekkendiagram / camera herstellen)
  'litho.building': 'Bouwen…',
  'litho.buildModelStale': 'Model bouwen · verouderd',
  'litho.buildModel': 'Model bouwen',
  'litho.buildNoContacts':
    'Nog geen litholaaggrenzen — open een dwarsprofiel op de litho-as, stel litho voor, aanvaard de lagen en kom hier terug om te bouwen',
  'litho.buildingSolids': 'Waterdichte lichaamssolids bouwen…',
  'litho.solidsStale': 'Een of meer lichaamssolids zijn verouderd — klik om te herbouwen',
  'litho.buildSolidsTitle': 'Bouw de 3D-lichaamssolids op basis van de aanvaarde laaggrenzen',
  // lithologie-detailvenster (rooster + solids-legende)
  'litho.createGeoFirst':
    'Maak eerst een geologisch model aan (geologiestap) — een lithostratigrafisch model verfijnt het.',
  'litho.clearing': 'Wissen…',
  'litho.clearShort': 'Wissen',
  'litho.instances': 'Instanties',
  'litho.resolving': 'Oplossen…',
  'litho.resolveInstances': 'Instanties oplossen',
  'litho.clearModelBody':
    'Alle litho-eenheden, laaggrenzen, correlaties en oppervlakken in dit model worden permanent verwijderd. Dit kan niet ongedaan gemaakt worden.',
  'litho.clearModelButton': 'Lithomodel wissen',
  'litho.parentExtrapolatedReview':
    'Bovenliggende formatie geëxtrapoleerd uit TIN — klik om te bevestigen of opnieuw toe te wijzen',
  'litho.noParentReview':
    'Geen bovenliggende formatie toegewezen — klik om toe te wijzen of los te maken',
  'litho.pillCounts': '{c} {cw}, {u} {uw}',
  'litho.contactWordOne': 'contact',
  'litho.contactWordMany': 'contacten',
  'litho.unitWordOne': 'eenheid',
  'litho.unitWordMany': 'eenheden',
  'litho.lensDefinedOne': '{n} lens gedefinieerd in deze formatie',
  'litho.lensDefinedMany': '{n} lenzen gedefinieerd in deze formatie',
  'litho.showMarkersN': 'Toon {n} markerings{bodies}',
  'litho.hideMarkersN': 'Verberg {n} markerings{bodies} (onvoldoende bepaald)',
  'litho.bodyWordOne': 'lichaam',
  'litho.bodyWordMany': 'lichamen',
  'litho.showMarkers': 'Markeringen tonen',
  'litho.hideMarkers': 'Markeringen verbergen',
  'litho.collapseGroup': 'Groep inklappen',
  'litho.expandGroup': 'Groep uitklappen',
  'litho.bodyCount': '{n} {bodies}',
  'litho.markersHidden': '({n} {markers} verborgen)',
  'litho.markers': '({n} {markers})',
  'litho.markerWordOne': 'markering',
  'litho.markerWordMany': 'markeringen',
  'litho.bodiesForName': 'Lichamen voor {name}',
  'litho.colourForBody': 'Kleur voor {name} #{ordinal}',

  // -------------------------------------------------------------------------
  // geotechniek
  // -------------------------------------------------------------------------
  'geotech.units': 'Geotechnische eenheden',
  'geotech.unitsFull': 'Geotechnische eenheden',
  'geotech.nadUnits': 'Geotechnische NAD-eenheden',
  'geotech.noUnits': 'Nog geen geotechnische eenheden',
  'geotech.noBodyModel': 'Nog geen geotechnisch lichaamsmodel',
  'geotech.noLithoModel': 'Nog geen lithostratigrafisch model',
  'geotech.selectedBody': 'Geselecteerd lichaam',
  // FLAG alt: pakkingsklassen | pakkingsdichtheidsklassen — NAD writes "gp"
  // (gepakt). "Pakking" is the shortest form that still reads as the NAD term.
  'geotech.estimateDisclaimer':
    'NAD-pakkingsklassen zijn schattingen afgeleid uit de sonderingen — toets ze aan de boorbeschrijvingen voor gebruik.',
  'geotech.rosterBlurb':
    'Geotechnische eenheden die grond beschrijven in dit model.',
  'geotech.runSubdivideHint':
    'Gebruik "Alle lichamen onderverdelen" om de lithostratigrafische eenheden in NAD-pakkingsklassen in te delen.',
  'geotech.buildHint':
    'Gebruik "Alle lichamen onderverdelen" in de profielstap (geotechnische as) en klik daarna op "Model opbouwen" in de geotechnische werkbalk om de 3D-lichamen per NAD-klasse te genereren.',
  'geotech.switchSolidFence': 'Wissel tussen het vaste lichaamsmodel en hekkendiagram',
  'geotech.resetAutoColour': 'Terug naar de automatische pakkingskleur',
  // De norm (uit sondering afgeleid) draagt geen badge — eigenaar 2026-08-27:
  // "CPT est. die flag mag eruit, bijna alle packingsklassen zijn altijd uit
  // sonderingen afgeleid". Enkel de uitzonderingen worden gemarkeerd.
  'geotech.badgeCptEstPartial': 'Geen sondering (deels)',
  'geotech.badgeNoCpt': 'Geen sondering',
  'geotech.badgeConfidence':
    'Samengevoegde betrouwbaarheid van de toegekende pakkingsklasse over alle sondeerlagen',
  'geotech.badgePartialHint':
    'De meeste banden zijn afgeleid uit de qc-reeks van de sonderingen. Minstens één band had geen conuswaarden in zijn lichaam en kreeg daarom de zwakste klasse die daar voorkwam. Controleer de banden met lage betrouwbaarheid voor gebruik.',
  'geotech.badgeNoCptHint':
    'Er liggen geen sondeergegevens achter deze klasse. Ze kreeg de zwakste klasse die in het lichaam voorkwam, of de ondergrens van de lithologie. Controleer voor gebruik.',
  'geotech.reSubdivideConfirm': 'Geotechnisch model opnieuw onderverdelen?',
  'geotech.reSubdivide': 'Opnieuw onderverdelen',
  'geotech.preflightKeep':
    'Voer er de gewone stappen Onderverdelen / Verdelen op uit en bouw daarna op',
  'geotech.preflightIgnore':
    'Volledig negeren — het resultaat is het model zoals het was voor ze geïmporteerd werden',
  'geotech.subdivideFirst': 'Verdeel eerst de lichamen onder.',
  // Geotech-eenheden-lijst (rechterpaneel).
  'geotech.unitsWithBands': '{count} met banden',
  'geotech.collapseSoil': 'Deze grondsoort inklappen',
  'geotech.expandSoil': 'Deze grondsoort uitklappen',
  'geotech.bandLabel': '{count} band',
  'geotech.bandsLabel': '{count} banden',
  'geotech.soilClasses': '{soil}-klassen',
  'geotech.contactLabel': '{count} contact in dit model',
  'geotech.contactsLabel': '{count} contacten in dit model',
  'geotech.chooseColor': '{color} — klik om een kleur voor deze eenheid te kiezen',
  'geotech.colorForUnit': 'Kleur voor {label}',
  'geotech.unitsCarryClass': '{count} aparte eenheden dragen deze klasse',
  'geotech.unitsClassed': 'Eenheden ingedeeld als {label}',
  'geotech.sampleSource': 'Bron van monster:',
} as const
