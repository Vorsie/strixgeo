// Shell chrome — gedeelde werkwoorden, opstart- en backendtoestanden, het
// projectscherm, projectmetadata en de stappenbalk.
//
// Part of the Dutch (BE) message catalogue — see 'locales/nl/index.ts'.
//
// A ``// FLAG alt: a | b — why`` line directly above a key marks a term the
// owner still has to rule on; the review table is generated from these
// comments, so the table can never drift from the file.

export const CHROME_NL = {
  // -------------------------------------------------------------------------
  // common
  // -------------------------------------------------------------------------
  'common.save': 'Opslaan',
  'common.cancel': 'Annuleren',
  'common.close': 'Sluiten',
  'common.delete': 'Verwijderen',
  // NOTE: distinct from delete — "remove" is always project-local hiding in
  // this app (docs/ux.md: a row X never deletes from the DB), so a softer verb.
  'common.remove': 'Weghalen',
  'common.open': 'Openen',
  'common.apply': 'Toepassen',
  'common.confirm': 'Bevestigen',
  'common.dismiss': 'Sluiten',
  'common.undo': 'Ongedaan maken',
  'common.reset': 'Herstellen',
  'common.retry': 'Opnieuw proberen',
  'common.rename': 'Hernoemen',
  'common.edit': 'Bewerken',
  'common.create': 'Aanmaken',
  'common.import': 'Importeren',
  'common.export': 'Exporteren',
  'common.loading': 'Laden…',
  'common.name': 'Naam',
  'common.depth': 'Diepte',
  // FLAG alt: Hoogte | Niveau — "peil" is the BE/mTAW word for an absolute
  // level and reads right on a borelog axis; "hoogte" is the generic NL word.
  'common.elevation': 'Peil',
  'common.optional': '(optioneel)',
  'common.none': '— geen —',
  'common.unspecified': '— (niet opgegeven)',
  'common.zoomIn': 'Inzoomen',
  'common.zoomOut': 'Uitzoomen',
  'common.resetZoom': 'Zoom herstellen',
  'common.resetView': 'Weergave herstellen',
  'common.thisCannotBeUndone': 'Dit kan niet ongedaan gemaakt worden.',

  // -------------------------------------------------------------------------
  // app
  // -------------------------------------------------------------------------
  'app.name': 'StrixGeo',
  'app.starting': 'StrixGeo API wordt gestart…',
  'app.bootFailedTitle': 'Kon de StrixGeo API niet starten',
  'app.bootFailedBody': 'Bekijk de Python-traceback in de developer console.',
  'app.backendFailedTitle': 'StrixGeo kon niet starten',
  'app.backendUnreachable': 'Backend onbereikbaar',
  'app.quit': 'StrixGeo afsluiten',
  'app.reload': 'StrixGeo herladen',
  'app.crashTitle': 'Er is een onverwachte fout opgetreden in StrixGeo',
  'app.dismissNotification': 'Melding sluiten',

  // -------------------------------------------------------------------------
  // welcome
  // -------------------------------------------------------------------------
  'welcome.tagline':
    'Open een bestaand projectbestand of maak een nieuw project aan om te beginnen met importeren',
  'welcome.createProject': 'Project aanmaken…',
  'welcome.openProject': 'Project openen uit bestand…',
  'welcome.recentProjects': 'Recente projecten',
  // NOTE: ruled 2026-08-27 — owner chose "Herstelde sessie".
  'welcome.recoveredWork': 'Herstelde sessie',
  'welcome.recoveredWorkBody':
    'Deze projecten zijn afgesloten met niet-opgeslagen werk. Open er een om het te herstellen.',
  'welcome.recoveryDeclined': 'Je hebt dit eerder niet hersteld',
  'welcome.openFailed':
    'Kon het gekozen projectbestand niet openen. Het bestand is mogelijk beschadigd, of de API is niet bereikbaar.',
  'welcome.fileMoved':
    'Zet het terug, of open het op de nieuwe locatie met "Project openen uit bestand".',

  // -------------------------------------------------------------------------
  // project
  // -------------------------------------------------------------------------
  'project.new': 'Nieuw project',
  'project.name': 'Projectnaam',
  'project.namePlaceholder': 'bv. GEO-22/040 Brugge',
  'project.metadata': 'Projectgegevens',
  'project.metadataBlurb':
    'Bewerk de hoofdgegevens van het project. Wijzigingen worden in de databank opgeslagen',
  'project.number': 'Projectnummer',
  'project.numberPlaceholder': 'bv. GEO-2026-042',
  'project.client': 'Opdrachtgever',
  'project.clientPlaceholder': 'bv. Haven van Antwerpen',
  'project.site': 'Locatie',
  'project.sitePlaceholder': 'bv. Haven Antwerpen — kaai 7',
  'project.description': 'Omschrijving',
  'project.descriptionHint': 'Vrije tekst over de opdracht',
  'project.tags': 'Labels',
  'project.tagsPlaceholder': 'Typ een label en druk op enter of komma',
  'project.status': 'Status',
  'project.statusActive': 'Actief',
  'project.statusOnHold': 'On hold',
  'project.statusCompleted': 'Afgerond',
  'project.phase': 'Fase',
  'project.phaseFeasibility': 'Haalbaarheid',
  'project.phaseDesign': 'Ontwerp',
  'project.phaseConstruction': 'Uitvoering',
  'project.phaseMonitoring': 'Monitoring',
  'project.defaultHorizontalCrs': 'Standaard horizontaal CRS',
  'project.defaultVerticalCrs': 'Standaard verticaal CRS',
  'project.close': 'Project sluiten',
  'project.closeConfirmTitle': 'Dit project sluiten?',
  'project.closeConfirmBody':
    'Het .strix-bestand en je opgeslagen gegevens blijven bewaard — je kan het altijd opnieuw openen.',
  'project.closeHint':
    'Project sluiten — je keert terug naar het startscherm. Het .strix-bestand en de gegevens in de databank blijven bewaard.',
  'project.save': 'Project opslaan (Ctrl+S)',
  'project.unsavedHint': 'Niet-opgeslagen wijzigingen — Bestand → Opslaan (Ctrl+S) om wijzigingen bij te houden',
  'project.createdSinceSave':
    'Aangemaakt sinds de laatste bewaaractie — Bestand → Opslaan om wijzigingen bij te houden',
  'project.discardChanges': 'Alle wijzigingen verwerpen',
  'project.discardBody':
    'Verwerpen kan niet ongedaan gemaakt worden. Met Annuleren blijft het project open zodat je kan opslaan.',

  // -------------------------------------------------------------------------
  // spine + shell
  // -------------------------------------------------------------------------
  // NOTE: ruled 2026-08-27 — owner chose "Werkvolgorde".
  'spine.title': 'Werkvolgorde',
  'spine.data': 'Data',
  // FLAG alt: Doorsneden | Dwarsprofielen — spine labels are capped at ~10
  // characters, so the short form is forced here even if the long surface name
  // ends up being "Dwarsprofielen".
  'spine.sections': 'Profielen',
  'spine.geology': 'Geologie',
  'spine.lithology': 'Litho',
  'spine.geotechnical': 'Geotech',
  'spine.parameters': 'Parameters',
  'spine.export': 'Export',
  'spine.selectionFooterAria': '{n} geselecteerd — klik om te wissen',
  'spine.selectionFooterTitle': '{n} geselecteerd over stappen — klik om te wissen',
  'spine.selectionFooterLabel': '{n} geselecteerd',
  'spine.selectionFooterAbbr': 'gek.',
  'shell.toolbar': 'Werkbalk',
  // FLAG alt: Inspector | Eigenschappen — the right-hand detail pane. "Inspector"
  // is what LeapFrog/Plaxis-adjacent tools use untranslated in NL builds.
  'shell.inspector': 'Detailvenster',
} as const
