// Data-stap — de importwerkwoorden en het kaart-/grafiekcanvas.
// WIRED: DataToolbar leest deze sleutels vandaag al.
//
// Part of the Dutch (BE) message catalogue — see 'locales/nl/index.ts'.

export const DATA_NL = {
  'data.toolbar.import': 'Importeren',
  // NOTE: ruled 2026-08-27 — owner chose "Kader tekenen…".
  'data.toolbar.drawingBbox': 'Kader tekenen…',
  'data.toolbar.menuLabel': 'Acties voor {label}',
  // FLAG alt: CPT importeren (.gef) — THE call of this whole review. The owner
  // writes "sonderingen"; BE practice says sondering, the file format and the
  // international literature say CPT. Ruling here propagates to ~30 strings.
  // One row per kind of investigation; Sondering and Boring open their import
  // routes in a submenu (owner 2026-10-04). The menu is titled Importeren, so
  // the rows are nouns.
  'data.toolbar.groupCpt': 'Sondering (CPT)',
  'data.toolbar.groupBorehole': 'Boring',
  'data.toolbar.cptGef': '.gef-bestanden',
  'data.toolbar.fromDov': 'Uit DOV (kader tekenen)',
  'data.toolbar.cptPdf': 'Uit een pdf-rapport',
  'data.toolbar.dmt': 'DMT',
  'data.toolbar.labTests': 'Laboproeven',
  'data.toolbar.monitoring': 'Monitoring',
  'data.toolbar.phaseTag': 'Fase 4',
  'data.canvas.map': 'Kaart',
  'data.canvas.chart': 'Grafiek',
  'data.canvas.loadingChart': 'Grafiek laden…',
  'data.canvas.loadingBorehole': 'Boring laden…',
  'data.import.status': 'Status DOV-import',
  'data.import.imported': 'Geïmporteerd',
  'data.import.alreadyExisted': 'Bestond al',
  'data.import.failed': 'Mislukt',
  'data.import.samplesAttached': 'Monsters gekoppeld',
  'data.import.observationsAttached': 'Waarnemingen gekoppeld',
  'data.import.streamClosed': 'De importstroom is onverwacht afgebroken',

  // -------------------------------------------------------------------------
  // data canvas — DOV-importstatuspaneel (DataCanvas).
  // -------------------------------------------------------------------------
  // FLAG alt: Sonderingen (CPT) importeren uit DOV… — carries the same CPT vs
  // sondering call as data.toolbar.importCptGef above.
  'data.import.importingCpts': 'Sonderingen importeren uit DOV…',
  'data.import.importingBoreholes': 'Boringen importeren uit DOV…',
  'data.import.complete': 'Import voltooid',
  'data.import.importFailed': 'Import mislukt',

  // -------------------------------------------------------------------------
  // importresultaat-meldingen (useInvestigationData).
  // -------------------------------------------------------------------------
  'data.import.countImported': '{n} geïmporteerd',
  'data.import.importedWithWarnings': '{ok} geïmporteerd ({warnings} met waarschuwingen)',
  'data.import.countAlreadyExisted': '{n} bestond al',
  'data.import.countFailed': '{n} mislukt',
  // FLAG alt: Bestaande sondering {name} bijgewerkt uit bestand — "vernieuwd"
  // vs "bijgewerkt" for refresh-on-reimport; also the CPT/sondering call.
  'data.import.refreshedOne': 'Bestaande sondering {name} vernieuwd uit bestand',
  'data.import.refreshedMany': '{n} vernieuwd uit bestand',
  'data.import.leftUnchangedOne': '{name} ongewijzigd gelaten',
  'data.import.leftUnchangedMany': '{n} ongewijzigd gelaten',
  'data.import.preDrillNotApplied':
    '{name}: een voorboring van {preDrill} m is opgegeven, maar de diepten beginnen op {firstDepth} m. De diepten zijn overgenomen zoals in het bestand; vergelijk ze met het verslag.',
  'data.import.noCptsInArea': 'Geen sonderingen in dit gebied gevonden',
  'data.import.noBoreholesInArea': 'Geen boringen in dit gebied gevonden',
  // FLAG alt: {n} waarnemingen — "waarn." is a compact toast abbreviation for
  // observations; spell it out if the toast has room.
  'data.import.countObs': '{n} waarn.',
  'data.import.countSamples': '{n} monsters',
  'data.import.countGrainSize': '{n} korrelgrootte',
  'data.import.subPhaseMissing': '. DOV gaf {items} niet terug',
  'data.import.subPhaseRetry': '; voer de import opnieuw uit om te herproberen',
  // Lokale weigering bij het tekenen van een DOV-kader (useInvestigationData) —
  // een leeg kader (klik zonder sleep) of een te groot kader wordt opgevangen
  // vóór de aanvraag, zodat de gebruiker nooit een kale "HTTP 422" ziet.
  'data.import.drawABox': 'Teken een kader op de kaart om te importeren.',
  'data.import.bboxTooLarge': 'Dat gebied is te groot. Teken een kleiner kader (maximaal 25 km breed).',

  // -------------------------------------------------------------------------
  // laadfout-meldingen (useInvestigationData).
  // -------------------------------------------------------------------------
  'data.load.cptListFailed': 'Laden van sonderingenlijst mislukt',
  'data.load.boreholeListFailed': 'Laden van boringenlijst mislukt',
  'data.load.chartFailed': 'Laden van grafiekgegevens mislukt',
  'data.load.boreholeDetailFailed': 'Laden van boringdetail mislukt',

  // -------------------------------------------------------------------------
  // meldingen bij mislukt opslaan van kaartoverlays (useMapOverlays).
  // -------------------------------------------------------------------------
  'data.overlay.saveTerrainFailed': 'Kon de terreinoverlay-instelling niet opslaan.',
  // FLAG alt: betrouwbaarheidsfade — "confidence fade" fades far-from-data map
  // markers; "vervaging" reads more Dutch than the loanword "fade".
  'data.overlay.saveConfidenceFadeFailed': 'Kon de betrouwbaarheidsvervaging-instelling niet opslaan.',
  'data.overlay.saveVirtueleBoringFailed': 'Kon de virtuele-boring-overlay-instelling niet opslaan.',

  // -------------------------------------------------------------------------
  // data inspector (DataInspector).
  // -------------------------------------------------------------------------
  'data.inspector.searchCpts': 'Sonderingen zoeken…',
  'data.inspector.searchBoreholes': 'Boringen zoeken…',
  'data.inspector.clearSearch': 'Zoekopdracht wissen',
  'data.inspector.selectedCount': '{n} geselecteerd',
  // Wist de SELECTIE. "Wis selectie" zodat een kaal "Wissen" nooit als
  // verwijderen leest naast "Verwijderen" (eigenaarsbeslissing 5, 2026-09-06;
  // beslissing 10, 2026-09-05).
  'data.inspector.clear': 'Wis selectie',
  // De wis-filteractie in de datumfilter. Een aparte sleutel van `clear` zodat
  // de twee wis-acties nooit in een rij botsen.
  'data.inspector.clearFilter': 'Wis filter',
  'data.inspector.selectAll': 'Alles selecteren',
  'data.inspector.selectAllInTab': 'Alles in dit tabblad selecteren',
  'data.inspector.allCptsRemoved': 'Alle sonderingen weggehaald',
  'data.inspector.noCptsImported': 'Nog geen sonderingen geïmporteerd',
  'data.inspector.noMatches': 'Geen resultaten voor deze zoekopdracht',
  'data.inspector.noCptsVisible': 'Geen sonderingen zichtbaar',
  'data.inspector.allBoreholesRemoved': 'Alle boringen weggehaald',
  'data.inspector.noBoreholesImported': 'Nog geen boringen geïmporteerd',
  'data.inspector.noBoreholesVisible': 'Geen boringen zichtbaar',
  // FLAG alt: sondering / sonderingen kept lowercase as a count noun ("5
  // sonderingen"); the CPT/sondering call applies here too.
  'data.inspector.cptWordOne': 'sondering',
  'data.inspector.cptWordMany': 'sonderingen',
  'data.inspector.countOfTotal': '{shown} van {total} {noun}',
  'data.inspector.count': '{n} {noun}',
  'data.inspector.removedRestoreAll': '{n} weggehaald · alles herstellen',
  'data.inspector.restoreRemovedTitle': 'Uit dit project weggehaalde items herstellen',
  'data.inspector.sortLabel': 'Sorteren:',
  'data.inspector.sortDefault': 'Standaard',
  'data.inspector.sortDate': 'Datum',
  'data.inspector.directionAsc': 'Richting: oplopend',
  'data.inspector.directionDesc': 'Richting: aflopend',
  'data.inspector.hiddenCount': 'Verborgen ({n})',
  'data.inspector.importedSinceSave': 'Geïmporteerd sinds laatste opslag. Bestand → Opslaan om vast te leggen',
  // FLAG alt: Geen maaiveldhoogte — "maaiveldpeil" uses the glossary term Peil
  // for elevation; "maaiveldhoogte" is the more common survey word.
  'data.inspector.noSurfaceElevation': 'Geen maaiveldpeil: handmatige Z-invoer nodig',
  'data.inspector.labTestsOne': '1 laboproef',
  'data.inspector.labTests': '{n} laboproeven',
  'data.inspector.removeFromProject': 'Uit project verwijderen',
  'data.inspector.dateRange': 'Datumbereik',
  'data.inspector.clearDateFilter': 'Datumfilter wissen',
  'data.inspector.fromDate': 'Vanaf datum',
  'data.inspector.toDate': 'Tot datum',

  // -------------------------------------------------------------------------
  // kaartweergave (MapView).
  // -------------------------------------------------------------------------
  // FLAG alt: Wachtend: {name} — pin discovered by DOV but not yet imported.
  'data.map.pending': 'In afwachting: {name}',
  // Offline notice on de 2D-kaart (audit L9).
  'data.map.offline': 'Offline: kaarttegels niet beschikbaar',
  // FLAG alt: sonderingslocatie(s) — CPT/sondering call; sr-only announcement.
  'data.map.pendingCptLocationsOne': '{n} sonderingslocatie wacht op import',
  'data.map.pendingCptLocationsMany': '{n} sonderingslocaties wachten op import',
  'data.map.noMarkersToFit': 'Geen zichtbare markeringen om op in te zoomen',
  'data.map.fitToDataOne': 'Kaart passend maken op {n} zichtbaar item',
  'data.map.fitToDataMany': 'Kaart passend maken op {n} zichtbare items',
  // FLAG alt: CPT — the map layer-control category header. Kept as "Sonderingen"
  // (a category of many); leave "CPT" if the owner wants the acronym on the map.
  'data.map.categoryCpt': 'Sonderingen',
  // FLAG alt: schaduwreliëf-bron — "hillshade" is common untranslated in BE GIS
  // tooling; "reliëfschaduw"/"schaduwreliëf" is the Dutch term.
  'data.map.noHillshadeIntro': 'Geen hillshade-bron voor dit CRS. Stel',
  'data.map.noHillshadeTo': 'in op',
  'data.map.noHillshadeBelgiumOr': '(België) of',
  'data.map.noHillshadeNetherlandsIn': '(Nederland) in',
  // -------------------------------------------------------------------------
  // lokale DOV-boring-XML-import (useBoreholeXmlImport).
  // -------------------------------------------------------------------------
  'data.toolbar.boreholeXml': 'DOV-XML-bestanden',
  'data.toolbar.boreholePdf': 'Uit een pdf-rapport',
  'data.import.boreholeRefreshedOne': 'Bestaande boring {name} vernieuwd uit bestand',
  'data.import.flagsToReviewOne': '{n} melding om na te kijken',
  'data.import.flagsToReviewMany': '{n} meldingen om na te kijken',
  'data.boreholeRefresh.title': 'Boringen vervangen die al in het project zitten?',
  'data.boreholeRefresh.body':
    ' bevat boringen die al in dit project zitten. Vervangen overschrijft hun boortrajecten, veldbeschrijving en beschrijvingen; een handmatige hoogte blijft behouden.',
  'data.boreholeRefresh.borehole': 'Boring',
  'data.boreholeRefresh.depth': 'Diepte',
  'data.boreholeRefresh.layers': 'Beschrijvingslagen',
  'data.boreholeRefresh.replace': 'Boringen vervangen',
  'data.importFlags.title': 'Rapport boringimport',
  'data.importFlags.intro':
    'Alles in deze bestanden dat een tweede blik verdient. Een melding hield nooit een import tegen.',
  'data.importFlags.noFlags': 'Geen meldingen',
  'data.importFlags.copy': 'Rapport kopiëren',
  'data.importFlags.copied': 'Gekopieerd',
  'data.importFlags.refreshed': 'vernieuwd',
  'data.importFlags.notImported': 'niet geïmporteerd',
  'data.importFlags.fileFailed': 'Bestand niet geïmporteerd: {message}',
  'data.importFlags.fileDeclined': 'Ongewijzigd gelaten: vervanging geweigerd',
  'data.importFlags.fileLevel': 'Heel het bestand',
  'data.importFlags.levelError': 'Fout',
  'data.importFlags.levelWarning': 'Waarschuwing',
  'data.importFlags.levelInfo': 'Opmerking',
} as const
