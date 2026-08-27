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
  // FLAG alt: 3D-model genereren | 3D-model bouwen — "opbouwen" carries the
  // sense of assembling from parts, which is what the voxel builder does;
  // "genereren" is the neutral software word.
  'geology.build3d': '3D-model opbouwen',
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
  // FLAG alt: Onvoldoende onderbouwd lichaam | Lichaam met te weinig gegevens —
  // "under-constrained" means fewer than 3 traces, so the surface is a
  // best-effort slab rather than a fitted body.
  'geology.underConstrainedBody': 'Onvoldoende bepaald lichaam',
  'geology.switchBasemap': 'Achtergrondkaart wisselen',
  'geology.formationCandidates': 'Kandidaat-formaties',
  'geology.targetFormationOptions': 'Opties voor doelformatie',
  'geology.keepSeparate': 'Apart houden',
  'geology.applySelection': 'Selectie toepassen',
  // FLAG alt: Samenvoegconflicten | Botsingen bij het bundelen — "lumping" is
  // the app's word for folding several source formations into one unit.
  'geology.lumpingCollisions': 'Waarschuwingen over samenvoegconflicten',
  'geology.selectFormationsBlurb':
    'Selecteer de formaties die je wil opnemen. Gebruik "→ zelfde als" op een regel om ze bij een andere te voegen.',
  'geology.filterFormationPlaceholder': 'Filter of typ de naam van een doelformatie',
  'geology.rerankPlaceholder': 'Typ om te herordenen of geef een naam in…',
  'geology.noStratigraphyCandidates': 'Geen kandidaten uit de stratigrafie gevonden.',

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
    'Kies of maak een lithologiemodel in het rechterpaneel. Teken laaggrenzen in de profielstap en klik daarna op Model opbouwen in de lithologiewerkbalk om de 3D-lichamen te genereren.',
  'litho.createThenSections':
    'Maak hierboven een lithologiemodel aan en open daarna de profielstap om laaggrenzen te tekenen.',
  'litho.drawThenBuild':
    'Teken laaggrenzen op de profielen en bouw daarna opnieuw op om de vlakken bij te werken.',
  'litho.buildToSeeBodies': 'Bouw het 3D-model op om de lichamen te zien.',
  'litho.allContentBlurb':
    'Alle litho-eenheden, laaggrenzen, correlaties en vlakken in dit model',
  'litho.renumberBodies': 'Litholichamen hernummeren op basis van hun correlatiegraaf',
  'litho.pickBodyColour': 'Kies een eigen kleur voor dit lichaam',
  'litho.resetBodyColour': 'Terug naar de lithologiekleur van de formatie',
  'litho.underConstrained':
    'Onvoldoende bepaald: minder dan 3 sondeer-/boortrajecten — benaderende plaat',
  'litho.confidenceFadeHint':
    'Vervaagde driehoeken in de 3D-weergave markeren zones waar het model extrapoleert, weg van nabije gegevens. Zet dit uit voor een egale kleur.',
  'litho.parentFormation': 'Bovenliggende geologische formatie',
  'litho.noParent': '— Geen bovenliggende formatie (losmaken) —',
  // FLAG alt: profielwanden | fence-diagram — see litho.exportFence.
  'litho.switchSolidFence': 'Wissel tussen vaste TIN-vlakken en profielwanden',
  // FLAG alt: Fence exporteren | Profielenwand exporteren — "fence diagram" has
  // no settled NL term. "Profielwand" is descriptive and self-explaining;
  // "fence" is what the international literature and LeapFrog use.
  'litho.exportFence': 'Profielwand exporteren',
  'litho.exportFenceHint':
    'Bewaar de 3D-profielwand als DXF (zet de weergave eerst op Profielwand)',
  'litho.resetCamera': 'Camera herstellen',
  'litho.resetCameraHint':
    'Klap elke gesplitste weergave dicht en breng de camera terug naar het volledige model',
  'litho.nothingToBuild':
    'Niets om op te bouwen — aanvaard eerst litholagen op een dwarsprofiel en bouw daarna op.',
  'litho.nothingToExportFence':
    'Niets om te exporteren — zet de 3D-weergave op Profielwand en zorg dat de wand vlakken bevat.',
  'litho.autoCorrelateNothing':
    'Autocorrelatie: geen correleerbare eenheden gevonden — aanvaard eerst de lithovoorstellen.',

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
    'NAD-pakkingsklassen zijn schattingen afgeleid uit de sonderingen — toets ze aan de boorbeschrijvingen voor je ze gebruikt.',
  'geotech.rosterBlurb':
    'Geotechnische eenheden die grond beschrijven in dit model. Een eenheid die niets beschrijft, staat niet in de lijst — er zit niets in.',
  'geotech.runSubdivideHint':
    'Gebruik "Alle lichamen onderverdelen" om de lithostratigrafische eenheden in NAD-pakkingsklassen in te delen.',
  'geotech.buildHint':
    'Gebruik "Alle lichamen onderverdelen" in de profielstap (geotechnische as) en klik daarna op "Model opbouwen" in de geotechnische werkbalk om de 3D-lichamen per NAD-klasse te genereren.',
  'geotech.switchSolidFence': 'Wissel tussen het vaste lichaamsmodel en profielwanden',
  'geotech.resetAutoColour': 'Terug naar de automatische pakkingskleur',
  // De norm (uit sondering afgeleid) draagt geen badge — eigenaar 2026-08-27:
  // "CPT est. die flag mag eruit, bijna alle packingsklassen zijn altijd uit
  // sonderingen afgeleid". Enkel de uitzonderingen worden gemarkeerd.
  'geotech.badgeCptEstPartial': 'Geen sondering (deels)',
  'geotech.badgeNoCpt': 'Geen sondering',
  'geotech.badgeConfidence':
    'Samengevoegde betrouwbaarheid van de toegekende pakkingsklasse over alle sondeerlagen',
  'geotech.badgePartialHint':
    'De meeste banden zijn afgeleid uit de qc-reeks van de sonderingen. Minstens één band had geen conus in zijn lichaam en kreeg daarom de zwakste klasse die daar voorkwam. Controleer de banden met lage betrouwbaarheid voor gebruik.',
  'geotech.badgeNoCptHint':
    'Er liggen geen sondeergegevens achter deze klasse. Ze kreeg de zwakste klasse die in het lichaam voorkwam, of de ondergrens van de lithologie. Controleer voor gebruik.',
  'geotech.reSubdivideConfirm': 'Geotechnisch model opnieuw onderverdelen?',
  'geotech.reSubdivide': 'Opnieuw onderverdelen',
  'geotech.preflightKeep':
    'Voer er de gewone stappen Onderverdelen / Verdelen op uit en bouw daarna op',
  'geotech.preflightIgnore':
    'Volledig negeren — het resultaat is het model zoals het was voor ze geïmporteerd werden',
  'geotech.subdivideFirst': 'Verdeel eerst de lichamen onder.',
} as const
