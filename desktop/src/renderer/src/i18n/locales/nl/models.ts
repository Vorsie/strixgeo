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
    'Selecteer de formaties die je wil opnemen. Gebruik "→ zelfde als" op een regel om ze bij een andere formatie te voegen. Als je selectie formaties weglaat die al in het model zitten, vraagt Toepassen of je ze aan het model toevoegt of het vervangt.',
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
    'Nog geen laaggrenzen — open een dwarsprofiel, vul dan vanuit de stratigrafie op de geologie-as of kies handmatig laaggrenzen voor je bouwt',
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
  // GeologyStage-samenvatting op de stappenbalk.
  'geology.summaryFormationOne': '{n} formatie',
  'geology.summaryFormationMany': '{n} formaties',
  'geology.summaryStale': '{n} verouderd',
  // Lege toestand van het geologiecanvas + inline CTA.
  'geology.emptyBuildPrompt': 'Nog geen 3D-model — bouw het op uit de stratigrafie.',
  'geology.adding': 'Toevoegen…',
  // Geologie-detailvenster (kop, kruisingsbanner, verwijderbevestiging, regels).
  'geology.stratigraphyLabel': 'Stratigrafie',
  'geology.crossingsNotChecked':
    'Kruisende vlakken niet gecontroleerd — bouw het 3D-model om te valideren.',
  'geology.crossingsCheckFailed':
    'Kruisende vlakken KONDEN niet gecontroleerd worden — dit is geen zuiver resultaat. Bouw opnieuw of heropen het project om opnieuw te controleren.',
  'geology.crossingsDetectedOne': '{n} kruisend vlak gedetecteerd',
  'geology.crossingsDetectedMany': '{n} kruisende vlakken gedetecteerd',
  'geology.emptyRosterHint':
    'Nog geen formaties — Vullen vanuit boringen of voeg er een toe, en bouw daarna het 3D-model.',
  'geology.boreholeInModel': '{name} in het model',
  'geology.deleteFormationBody':
    'en elke laaggrens + geotechnische eenheid die ernaar verwijst, wordt uit het geologisch model verwijderd. Dit kan niet ongedaan gemaakt worden (tot Bestand → Opslaan zit de wijziging nog niet in de .gmproj — sluiten zonder opslaan draait ze terug).',
  'geology.dragToReorderNamed': '{name} slepen om de volgorde te wijzigen',
  'geology.colorClickToChange': '{color} — klik om de kleur te wijzigen',
  'geology.changeColorOf': 'Kleur van {name} wijzigen',
  // Formatieselectievenster (Vullen vanuit boringen).
  'geology.formationsFoundOne': '{n} formatie gevonden',
  'geology.formationsFoundMany': '{n} formaties gevonden',
  'geology.candAll': 'Alle',
  'geology.candNone': 'Geen',
  'geology.foundInBoreholesOne': 'gevonden in {n} boring',
  'geology.foundInBoreholesMany': 'gevonden in {n} boringen',
  'geology.updating': 'Bijwerken…',
  'geology.boreholeWordOne': 'boring',
  'geology.boreholeWordMany': 'boringen',
  'geology.boundaryWordOne': 'grens',
  'geology.boundaryWordMany': 'grenzen',
  'geology.formationWordOne': 'formatie',
  'geology.formationWordMany': 'formaties',
  'geology.contactWordOne': 'laaggrens',
  'geology.contactWordMany': 'laaggrenzen',
  'geology.collisionSummary':
    '{count} {boreholeWord} had lagen die naar dezelfde formatie samengevoegd werden — ondiepste behouden, {dropped} {boundaryWord} weggelaten; controleer je groepering',
  'geology.collisionInBorehole': 'in boring',
  'geology.collisionCollidingNames': ': botsende namen:',
  'geology.collisionKept': '. Bovenste behouden op {top}m, {dropped} weggelaten.',
  'geology.deletionWarning':
    '{fCount} {formationWord} en {cCount} {contactWord} zitten niet in je selectie. Toepassen zal vragen of je ze behoudt of verwijdert.',
  'geology.reassignedToClickChange': 'Opnieuw toegewezen aan "{label}" — klik om te wijzigen',
  'geology.reassignToAnother': '"{name}" aan een andere formatie toewijzen',
  'geology.sameAs': '→ zelfde als',
  'geology.useCustomName': 'Gebruik "{name}"',
  // Geologie-hook-toasts (useGeologicalModel / useGeologicalModelOps).
  'geology.createModelFailed': 'Kon het geologisch model niet aanmaken — controleer de verbinding.',
  'geology.scanStratigraphyFailed':
    'Kon de boorstratigrafie niet scannen — controleer de verbinding.',
  // FLAG alt: {n} laag (lagen) — English dodges the plural with "layer(s)"; Dutch
  // "laag/lagen" mirrors it but reads awkwardly.
  'geology.nothingCreated':
    'Niets aangemaakt — {n} laag/lagen al ingevuld. Gebruik Ontdubbelen of Model verwijderen om te resetten en probeer opnieuw.',
  'geology.removedNotInSelection': 'Verwijderd: {n} {unit} die niet in je selectie zaten: {names}.',
  'geology.seededContacts': '{created} laaggrenzen gevuld.',
  'geology.seededContactsSkipped': '{created} laaggrenzen gevuld. {skipped}',
  'geology.seedSkippedFragmentOne': '{n} laag overgeslagen — formatie niet in je model.',
  'geology.seedSkippedFragmentMany': '{n} lagen overgeslagen — formatie niet in je model.',
  'geology.nothingSeeded':
    'Niets gevuld — {skipped} Voeg ze toe in de geologiestap om ze hier te plaatsen.',
  'geology.alreadyInSyncNothingToAdd': 'Al gesynchroniseerd — niets toe te voegen.',
  'geology.seedContactsFailed': 'Kon geen laaggrenzen vullen vanuit de stratigrafie.',
  'geology.dedupeAlreadyClean': 'Al opgeschoond — geen duplicaten gevonden.',
  'geology.dedupeRemoved':
    'Verwijderd: {d} dubbele {contactWord} over {g} (anker, formatie)-{pairWord}.',
  'geology.pairWordOne': 'paar',
  'geology.pairWordMany': 'paren',
  'geology.cleanupFailed': 'Kon de opschoning niet uitvoeren — zie console.',
  'geology.noFormationsToRebuild': 'Nog geen formaties met keuzes — niets om te herbouwen.',
  'geology.cacheInSync': 'Cache al gesynchroniseerd ({n} {formationWord} gecontroleerd).',
  'geology.rebuiltSurfaces': '{rebuilt} van {considered} {surfaceWord} herbouwd',
  'geology.surfacesAlreadyCurrent': '{considered} {surfaceWord} al actueel',
  'geology.reorderedByDepth': '; {n} {formationWord} herordend op diepte',
  'geology.surfaceWordOne': 'oppervlak',
  'geology.surfaceWordMany': 'oppervlakken',
  'geology.rebuildSurfacesFailed': 'Kon de oppervlakken niet herbouwen — zie console.',
  'geology.plaxisExported': 'Plaxis 3D-script geëxporteerd.',
  'geology.plaxisExportFailed': 'Kon het Plaxis-script niet exporteren.',

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
  'litho.excludedBoreholesHeading': 'Uitgesloten uit de lithologische opbouw',
  'litho.excludedBoreholesHint':
    'Deze boringen blijven buiten de lithologische opbouw. Neem er een opnieuw op om ze terug te brengen.',
  'litho.includeBoreholeAgain': 'Opnieuw opnemen',
  'litho.includeBoreholeAgainAria': '{name} opnieuw opnemen in de lithologische opbouw',
  'litho.excludedBoreholeUnknown': 'Onbekende boring',
  'litho.boreholeIncludedToast': 'Boring opnieuw opgenomen in de lithologische opbouw',
  'litho.boreholeExcludedToast': 'Boring uitgesloten van de lithologische opbouw',
  // Debt #65 (exclude gesture): "Boringen in het model" scope-lijst — de
  // gebaar in de UI om een boring uit te sluiten van de lithologische opbouw
  // (spiegelt de lijst in de geologische inspector).
  'litho.boreholesInModel': 'Boringen in het model',
  'litho.showBoreholeScopes': 'Toon / verberg de schakelaars per boring',
  'litho.boreholesInModelHint': 'Vink een boring uit om ze buiten de lithologische opbouw te laten.',
  'litho.boreholeInModel': '{name} in de lithologische opbouw',
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
  // Achtergrond-3D-bouw (debt #282): fase-labels voor de voortgangsbalk + de
  // Annuleren-knop. Fase-sleutels worden opgezocht op de backend-fasenaam.
  'litho.building3dModel': '3D-model bouwen…',
  'litho.buildProgressStarting': 'Bouw starten…',
  'litho.buildProgressLabel': 'Voxels labelen…',
  'litho.buildProgressReconcile': 'Profielen afstemmen…',
  'litho.buildProgressExtract': 'Lichaamssolids extraheren…',
  'litho.buildProgressPersist': 'Opslaan…',
  'litho.buildCancel': 'Annuleren',
  'litho.buildCancelling': 'Annuleren…',
  'litho.buildCancelled': 'Bouw geannuleerd',
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
  // Litho-hook-toasts + LithoGeoSnapDialog + LithologyCanvas.
  'litho.placeContactFailed': 'Kon de litho-formatielaaggrens niet plaatsen.',
  'litho.createFormationFailed': 'Kon de litho-formatie niet aanmaken.',
  'litho.noFormationsToRebuild':
    'Nog geen litho-formaties met laaggrenzen — niets om te herbouwen.',
  'litho.cacheInSync': 'Lithocache gesynchroniseerd ({n} {surfaceWord} gecontroleerd).',
  'litho.surfaceWordOne': 'oppervlak',
  'litho.surfaceWordMany': 'oppervlakken',
  'litho.rebuiltSurfaces': '{rebuilt} van {considered} litho-{surfaceWord} herbouwd.',
  'litho.rebuildSurfacesFailed': 'Kon de litho-oppervlakken niet herbouwen — zie console.',
  'litho.modelAlreadyEmpty': 'Lithomodel is al leeg.',
  'litho.clearedModel': 'Lithomodel gewist — {c} {contactWord}, {u} {unitWord} verwijderd.',
  'litho.clearModelFailed': 'Kon het lithomodel niet wissen — zie console.',
  'litho.createGeoModelFirst':
    'Maak een geologisch model aan voor je een lithostratigrafisch model toevoegt.',
  'litho.createModelFailed': 'Kon het lithostratigrafisch model niet aanmaken.',
  'litho.activateModelFailed': 'Kon het lithostratigrafisch model niet activeren.',
  'litho.deleteModelFailed': 'Kon het lithostratigrafisch model niet verwijderen.',
  'litho.nothingToBuildYet': 'Nog niets om te bouwen — open eerst een dwarsprofiel op de litho-as.',
  'litho.builtBodies': '{n} {bodyWord} gebouwd',
  'litho.nothingCouldBeBuilt':
    'Er kon niets gebouwd worden — {reason}. Het opgeslagen 3D-model is gewist.',
  'litho.uncoveredInvestigations':
    '{n} {investigationWord} buiten de modelvoetafdruk, ZONDER 3D-model: {named}{rest}',
  'litho.investigationWordOne': 'onderzoek',
  'litho.investigationWordMany': 'onderzoeken',
  'litho.moreCount': ', +{n} meer',
  'litho.underConstrainedBodies':
    '{n} {bodyWord} onvoldoende bepaald (minder dan 3 sondeer-/boortrajecten — plaatbenadering)',
  'litho.saveBodyColourFailed': 'Kon de lichaamskleur niet opslaan — probeer opnieuw.',
  'litho.gridTooLargeDefault': 'Het gevraagde raster is te groot om te bouwen.',
  'litho.storedModelUnchanged': 'Het opgeslagen 3D-model is niet gewijzigd.',
  'litho.gridTooLargeRetry':
    '{reason} Probeer opnieuw met een horizontale afstand van minstens {suggested} m. {untouched}',
  'litho.gridTooLargeNoRetry': '{reason} {untouched}',
  'litho.buildFailedGeneric': 'Kon de lichaamssolids niet bouwen — controleer de verbinding.',
  'litho.autoCorrelateFull': 'Autocorrelatie: model al volledig gecorreleerd — geen nieuwe koppelingen.',
  'litho.autoCorrelateCreated':
    'Autocorrelatie: {created} {edgeWord} aangemaakt, {existing} koppeling(en) bestonden al.',
  'litho.edgeWordOne': 'koppeling',
  'litho.edgeWordMany': 'koppelingen',
  // FLAG alt: uitwig-lenskandidaat | pinch-out-lenskandidaat — "pinch-out lens"
  // (a lens that wedges out); owner jargon "wigging out" = pinches out laterally.
  'litho.pinchOutLensOne':
    '{n} uitwiggende lenskandidaat uit kruisingen — getoond als amberkleurige ruiten; de kruisende koppelingen zijn niet getekend.',
  'litho.pinchOutLensMany':
    '{n} uitwiggende lenskandidaten uit kruisingen — getoond als amberkleurige ruiten; de kruisende koppelingen zijn niet getekend.',
  'litho.autoCorrelateFailed': 'Autocorrelatie mislukt — zie console.',
  'litho.noSuggestionsToClear': 'Geen correlatievoorstellen om te wissen.',
  'litho.clearedSuggestionsOne': '{n} correlatievoorstel gewist.',
  'litho.clearedSuggestionsMany': '{n} correlatievoorstellen gewist.',
  'litho.clearSuggestionsFailed': 'Kon de voorstellen niet wissen — zie console.',
  // FLAG alt: spookvoorstellen — "ghost" is kept as a loanword elsewhere in the
  // NL catalogue (ghost-kolom, litho-ghost-overlay), so "ghost-voorstellen" here.
  'litho.noGhostToStrip': 'Geen ghost-voorstellen om te verwijderen.',
  'litho.noScopedGhostToStrip': 'Geen {scope}-ghost-voorstellen om te verwijderen.',
  'litho.scopeCpt': 'sondering',
  'litho.scopeBorehole': 'boring',
  'litho.strippedAdmixtures': 'Bijmengingen verwijderd uit {n} {layerWord}.',
  'litho.layerWordOne': 'laag',
  'litho.layerWordMany': 'lagen',
  'litho.noAdmixturesToRestore': 'Geen overschreven boorbijmengingen om te herstellen.',
  'litho.restoredAdmixtures': 'Segmenter-bijmengingen hersteld op {n} boor{layerWord}.',
  'litho.fetchSuggestionsFailed': 'Kon geen lithostratigrafische voorstellen ophalen.',
  'litho.acceptSuggestionFailed': 'Kon het lithovoorstel niet aanvaarden.',
  'litho.acceptAllFailed': 'Kon niet alle lithovoorstellen aanvaarden.',
  'litho.suggestedFailures': '{ok}/{total} voorgesteld — {failed} mislukt.',
  'litho.acceptLayersFailed': 'Kon de litholagen niet aanvaarden.',
  'litho.acceptedAnchorsInference': '{n} {anchorWord} aanvaard — inferentie bijgewerkt.',
  'litho.acceptedAnchors': '{n} {anchorWord} aanvaard.',
  'litho.anchorWordOne': 'anker',
  'litho.anchorWordMany': 'ankers',
  'litho.acceptedFailures': '{ok}/{total} aanvaard — {failed} mislukt.',
  // FLAG alt: Geen hekdiagrampanelen — "fence panels" = walls of the fence diagram
  // (elsewhere "Hekkendiagram" / "3D-profielwand").
  'litho.fenceEmptyHint': 'Geen hekpanelen — aanvaard correlaties in de profielstap',
  // FLAG alt: Koppelen aan geologische laaggrens? — "snap" = vastklikken.
  'litho.snapTitle': 'Vastklikken aan geologische laaggrens?',
  'litho.snapContactAt': 'De litholaaggrens op',
  'litho.snapWithinMulti': 'ligt binnen de vastkliktolerantie van twee geologische laaggrenzen.',
  'litho.snapWithinSingle': 'ligt binnen de vastkliktolerantie van een geologische laaggrens.',
  'litho.snapPickContact': 'Kies een geologische laaggrens',
  'litho.snapDistanceAway': '({distance} m verderop)',
  'litho.snapGeoContactAt': 'Geologische laaggrens op',
  'litho.snapCancelKeepSeparate': 'Annuleren — apart houden',
  'litho.snapMoveGeoToLitho': 'Geologische naar litho verplaatsen',
  'litho.snapLithoToGeo': 'Litho naar geologische vastklikken',

  // -------------------------------------------------------------------------
  // geotechniek
  // -------------------------------------------------------------------------
  'geotech.units': 'Geotechnische eenheden',
  'geotech.unitsFull': 'Geotechnische eenheden',
  // De L1-lijst bevat nu grondgroepen, geen NAD-klasserijen (2026-08-31).
  'geotech.soilGroups': 'Geotechnische grondgroepen',
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
  // Body van het bevestigingsvenster "Opnieuw onderverdelen"
  // (ReSubdivideConfirmDialog), gesplitst rond de vet/cursief benadrukte delen.
  'geotech.thisSectionFallback': 'dit profiel',
  'geotech.reSubdivideModelPre': 'Opnieuw afleiden onder',
  'geotech.reSubdivideModelMid': 'wist alle onderverdelingen',
  'geotech.reSubdivideModelWide': 'modelbreed',
  'geotech.reSubdivideModelPost':
    '— de pakkingsbanden en koppelingen van elk profiel worden opnieuw opgebouwd uit de sondeergegevens, en elke boring wordt leeg tot je ze opnieuw verdeelt.',
  'geotech.reSubdivideRegenPre':
    'Opnieuw onderverdelen genereert de geotechnische pakkingscorrelaties op',
  'geotech.reSubdivideRegenPost':
    '— alle handmatige koppelingen die je daar gemaakt hebt, worden gewist.',
  'geotech.reSubdivideHandPre': 'Het bouwt ook de pakkingsbanden op',
  'geotech.reSubdivideHandMid': 'opnieuw op uit de sondeergegevens, dus zijn',
  'geotech.reSubdivideHandBandOne': '{n} handmatig bewerkte band',
  'geotech.reSubdivideHandBandMany': '{n} handmatig bewerkte banden',
  'geotech.reSubdivideHandPost':
    'keren terug naar de grenzen van de segmenter. Dat kan niet hersteld worden.',
  'geotech.reSubdivideAltPre': 'Om de automatische koppelingen terug te krijgen',
  'geotech.reSubdivideAltEm': 'zonder',
  'geotech.reSubdivideAltPost':
    'je eigen kwijt te raken, annuleer en gebruik Pakking correleren → Automatisch correleren.',
  // Geotech-eenheden-lijst (rechterpaneel) — grondsoort ▸ lithologisch lichaam ▸
  // pakkingslichaam (eigenaarsbeslissing 2026-08-31, wandelinterview).
  'geotech.unitsWithBands': '{count} met banden',
  'geotech.collapseSoil': 'Deze grondsoort inklappen',
  'geotech.expandSoil': 'Deze grondsoort uitklappen',
  'geotech.collapseLithoBody': 'Dit lithologisch lichaam inklappen',
  'geotech.expandLithoBody': 'Dit lithologisch lichaam uitklappen',
  // Een pakkingslichaam waarvan het lithologische ouderlichaam nog niet
  // gestempeld is, valt in deze bak in plaats van te verdwijnen. Benoemd naar de
  // OORZAAK (nog geen litho-ouder, verdwijnt bij de volgende herberekening) —
  // NIET "Niet gegroepeerd", wat zou botsen met de handmatige "(groep N)"-taal
  // op dezelfde bladeren (ux-reviewer 2026-09-01).
  'geotech.noLithoBody': 'Zonder litho-lichaam',
  // De handmatige-groep-tag op een pakkingslichaam dat in een groep is
  // samengevoegd (debt #278 D4). FLAG: door de eigenaar te bevestigen.
  'geotech.groupTag': '(groep {count})',
  // De gegroepeerde-lichaam Parameters-kop (debt #278 D2). FLAG: door de
  // eigenaar te bevestigen ("Groep N — N lichamen") + kop.
  'geotech.groupHeader': 'Groep {group} — {count} lichamen',
  'geotech.groupProvenanceHeading': 'Bron-lithostratigrafische lichamen',
  'geotech.soilBodies': '{soil}-lichamen',
  'geotech.packingBodiesIn': 'Pakkingslichamen in {label}',
  'geotech.bandLabel': '{count} band',
  'geotech.bandsLabel': '{count} banden',
  'geotech.contactLabel': '{count} contact in dit model',
  'geotech.contactsLabel': '{count} contacten in dit model',
  'geotech.chooseColor': '{color} — klik om een kleur voor deze eenheid te kiezen',
  'geotech.colorForUnit': 'Kleur voor {label}',
  'geotech.sampleSource': 'Bron van monster:',
  // Geotech-hook-toasts + shell-componenten. Build model / Building… /
  // Build model · stale / Export fence / Reset camera hergebruiken de litho.*-sleutels.
  'geotech.selectLithoModelFirst': 'Selecteer eerst een lithostratigrafisch model.',
  // FLAG alt: verb name "Subdivide all bodies" — matches the toolbar verb (owned
  // by the sections module); confirm the Dutch button label there.
  'geotech.subdivideAllBodiesFailed': '"Alle lichamen onderverdelen" mislukt — zie console.',
  'geotech.subdivideCptsFailed': '"Sonderingen onderverdelen" mislukt — zie console.',
  'geotech.tieReviewOne':
    '{n} aanvaarde pakkingskoppeling moet nagekeken worden — de band waarop ze getekend werd, is gewijzigd. Let op de !-tekens op de geotechnische profielen.',
  'geotech.tieReviewMany':
    '{n} aanvaarde pakkingskoppelingen moeten nagekeken worden — de band waarop ze getekend werden, is gewijzigd. Let op de !-tekens op de geotechnische profielen.',
  'geotech.tieReviewBoreholeOne':
    '{n} aanvaarde pakkingskoppeling moet nagekeken worden — de boorband waarop ze getekend werd, is gewijzigd. Let op de !-tekens op de geotechnische profielen.',
  'geotech.tieReviewBoreholeMany':
    '{n} aanvaarde pakkingskoppelingen moeten nagekeken worden — de boorband waarop ze getekend werden, is gewijzigd. Let op de !-tekens op de geotechnische profielen.',
  // FLAG alt: verb name "1 · Subdivide CPTs" — matches the sections-toolbar verb.
  'geotech.divideBoreholesNeedsCpts':
    'Voer eerst "1 · Sonderingen onderverdelen" uit voor je boringen verdeelt.',
  'geotech.noBoreholeSelected': 'Geen boring geselecteerd — niets om te verdelen.',
  'geotech.divideBoreholesFailed': 'Boringen verdelen mislukt — zie console.',
  'geotech.confidenceHigh': 'Hoog',
  // FLAG alt: Gemiddeld — "Medium" confidence tier.
  'geotech.confidenceMedium': 'Middel',
  'geotech.confidenceLow': 'Laag',
  'geotech.nadClassParen': '(NAD {nad})',
  'geotech.noLithoModelHint':
    'Maak een lithostratigrafisch model aan in de lithologiestap en aanvaard de lithovoorstellen; kom daarna hier terug om het 3D geotechnisch model te bouwen.',
  // FLAG alt: Geen hekdiagrampanelen — "fence panels".
  'geotech.fenceEmptyHint': 'Geen hekpanelen — verbind pakkingsbanden in de profielstap',
  'geotech.subdividing': 'Onderverdelen…',
  'geotech.buildNoBands':
    'Nog geen geotechnische banden — gebruik eerst "Alle lichamen onderverdelen" in de profielstap (geotechnische as) en bouw daarna',
  'geotech.buildSubdividingTitle': 'De onderzoeken zonder pakkingsbanden onderverdelen en daarna bouwen…',
  'geotech.buildingSolidsTitle': 'Waterdichte NAD-lichaamssolids bouwen…',
  'geotech.solidsStaleTitle':
    'Een of meer geotechnische lichaamssolids zijn verouderd — klik om te herbouwen',
  'geotech.buildSolidsTitle': 'Bouw de 3D NAD-lichaamssolids uit de geotechnische partitie',
  'geotech.excludedTestsOne': '{count} onderzoek uitgesloten',
  'geotech.excludedTestsMany': '{count} onderzoeken uitgesloten',
  'geotech.excludedTitleOne':
    'De laatste build negeerde {names} — het heeft geen pakkingsbanden, dus het model is dat van voor het geïmporteerd werd.',
  'geotech.excludedTitleMany':
    'De laatste build negeerde {names} — ze hebben geen pakkingsbanden, dus het model is dat van voor ze geïmporteerd werden.',
  'geotech.excludedClickHint': 'Klik om de volgende te openen op een dwarsprofiel.',
  'geotech.excludedAriaHint': 'Activeer om het volgende uitgesloten onderzoek te openen.',
  'geotech.preflightTitleOne': 'Dit onderzoek heeft nog geen pakkingsbanden',
  'geotech.preflightTitleMany': 'Deze {count} onderzoeken hebben nog geen pakkingsbanden',
  'geotech.preflightBodyOne':
    'Het maakt deel uit van het model waarop de build gekaderd is, dus de build zou er een gat rond tekenen zonder pakkingsgegevens om te vullen. Open het om het handmatig onder te verdelen, of kies een van de twee builds hieronder.',
  'geotech.preflightBodyMany':
    'Ze maken deel uit van het model waarop de build gekaderd is, dus de build zou er een gat rond tekenen zonder pakkingsgegevens om te vullen. Open ze elk om ze handmatig onder te verdelen, of kies een van de twee builds hieronder.',
  'geotech.preflightVisitTitle': 'Open {name} op een dwarsprofiel dat het bevat',
  'geotech.preflightDropWarning':
    '— Bouwen zonder {name} verwijdert {sections} uit de build; die ruimte wordt vanuit de naburige profielen gevuld.',
  'geotech.preflightBuildWithoutOne': 'Bouwen zonder het',
  'geotech.preflightBuildWithoutMany': 'Bouwen zonder ze',
  'geotech.preflightSubdivideOne': 'Het onderverdelen & bouwen',
  'geotech.preflightSubdivideMany': 'Ze onderverdelen & bouwen',
  'geotech.preflightGiveUpOne':
    '{names} heeft nog geen pakkingsbanden, dus er is niets gebouwd — verdeel onder in de profielstap en bouw dan opnieuw.',
  'geotech.preflightGiveUpMany':
    '{names} hebben nog geen pakkingsbanden, dus er is niets gebouwd — verdeel onder in de profielstap en bouw dan opnieuw.',
  'geotech.reportBroken': '{failed} van {total} modelgaranties geschonden{tail}',
  'geotech.reportNotCheckedTail': ', {n} niet gecontroleerd',
  'geotech.reportHeld': '{held} van {total} modelgaranties nageleefd, {n} niet gecontroleerd',
  'geotech.reportClean': 'geen gaten — alle {total} modelgaranties nageleefd',
  'geotech.reportVisitSpot': 'Open {name} op deze plek',
  'geotech.reportSectionFallback': 'het profiel',
  'geotech.reportShowMe': 'Toon me',
  'geotech.reportNotChecked': 'Niet gecontroleerd — {reason}.',
  'geotech.reportModelCheck': 'Modelcontrole',
  'geotech.reportHideDetail': 'Details verbergen',
  'geotech.reportShowDetail': 'Toon elke garantie en waar ze staat',
  'geotech.reportLess': 'Minder',
  'geotech.reportDetail': 'Details',
  // Bijmenging → NAD-familie prompt (eigenaarsbeslissing 2026-09-04). Gevraagd
  // vóór het onderverdelen voor eenheden waarvan de NAD-tabel de bijmenging op
  // twee manieren kan lezen.
  'geotech.admixtureChoiceTitle': 'Welke NAD-klassen voor deze bijmengingen?',
  'geotech.admixtureChoiceBody':
    'Deze eenheden bevatten een bijmenging die de NAD-tabel op twee manieren kan classificeren. Kies per eenheid of je ze als de zuivere grondsoort of met bijmenging classificeert voordat je onderverdeelt.',
  'geotech.admixturePureOption': 'Zuiver {soil}',
  'geotech.admixtureWithOption': '{soil} met bijmenging',
  'geotech.admixtureChoiceConfirm': 'Onderverdelen',
  'geotech.admixtureChoiceCancel': 'Annuleren',
  'geotech.admixtureChoiceGate': 'Kies voor elke eenheid een klasse om verder te gaan.',
  'geotech.admixtureChoiceReopen': 'NAD-keuzes bijmenging',
  'geotech.admixtureChoiceReopenTitle':
    'Bekijk of wijzig in welke NAD-familie elke bijmengingseenheid wordt geclassificeerd.',
  'geotech.admixtureChoiceSaveFailed':
    'Kon de NAD-keuzes voor de bijmenging niet opslaan — er is niets onderverdeeld.',
} as const
