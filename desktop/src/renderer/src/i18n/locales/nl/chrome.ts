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
  // The action button on an IRREVERSIBLE database-delete confirm. Owner
  // 2026-09-03 renamed the reversible hide (``common.remove``) from "Weghalen"
  // to "Verwijderen", so the irreversible confirms must read more emphatically
  // to stay distinct (docs/ux.md reversible-vs-irreversible). "Definitief
  // verwijderen" = permanently delete from the database.
  'common.deletePermanently': 'Definitief verwijderen',
  // NOTE: owner 2026-09-03 — "verwijderen is beter" for the reversible
  // project-local hide on the data rows. It now shares the word "Verwijderen"
  // with delete; the distinction lives in context (an inline row action + undo
  // vs a confirm dialog that reads "Definitief verwijderen").
  'common.remove': 'Verwijderen',
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
  'app.bootFailedBody': 'Help → Show log file… opent het backend-logboek met de Python-traceback.',
  'app.backendFailedTitle': 'StrixGeo kon niet starten',
  'app.backendUnreachable': 'Backend onbereikbaar',
  // Weigeringscodes van de backend die een ingenieur in normaal gebruik kan zien.
  'api.code.dovImportTooLarge': 'Dit kader bevat meer records dan één import aankan. Teken een kleiner kader.',
  'api.code.dovImportAlreadyRunning': 'Deze DOV-import loopt al.',
  'api.code.bodyPartitionLocked': 'Een andere bewerking op de lichamen loopt nog op dit model. Probeer het zo opnieuw.',
  'api.code.lockTimeout': 'De database was te lang bezet. Probeer het zo opnieuw.',
  'app.backendRestarting': 'Opnieuw verbinden met de backend…',
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
  'welcome.openNewerBuild':
    'Dit project is opgeslagen met een nieuwere versie van StrixGeo (bestandsformaat {version}). Werk StrixGeo bij om het te openen — je gegevens zijn veilig.',
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
  // Bevestiging voor terugzetten naar bestand (eigenaarsbeslissing, installer #26).
  'project.closeForceRevertTitle': 'Terugzetten naar bestand en wijzigingen verliezen?',
  'project.closeForceRevertBody':
    '{file} is niet de laatste opgeslagen versie van dit project. Terugzetten wist ' +
    'het werk van deze sessie en alles wat sindsdien in het project is opgeslagen ' +
    'definitief.',
  'project.closeForceRevertConfirm': 'Terugzetten naar bestand en sluiten',
  'project.discardBackupForceRevertTitle': 'Terugzetten naar bestand en back-up verwijderen?',
  'project.discardBackupForceRevertBody':
    '{file} is niet de laatste opgeslagen versie van dit project. Toch terugzetten wist ' +
    'de gecrashte sessie en alles wat sindsdien in het project is opgeslagen definitief; ' +
    'Annuleren behoudt de back-up.',
  'project.discardBackupForceRevertConfirm': 'Terugzetten naar bestand en back-up verwijderen',

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
  'spine.geology': 'Stratigrafie',
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
  // Per-stage crash card (audit M5).
  'shell.stageError.title': 'Deze stap werkt niet meer',
  'shell.stageError.body':
    'De andere stappen en je gegevens zijn niet aangetast. Herstel deze stap om opnieuw te proberen.',
  'shell.stageError.reset': 'Stap herstellen',

  // -------------------------------------------------------------------------
  // common — count words + list joiners.
  // -------------------------------------------------------------------------
  'common.cptWordOne': 'sondering',
  'common.cptWordMany': 'sonderingen',
  'common.boreholeWordOne': 'boring',
  'common.boreholeWordMany': 'boringen',
  'common.formationWordOne': 'formatie',
  'common.formationWordMany': 'formaties',
  // FLAG alt: profiel | dwarsprofiel — "dwarsprofiel" is the full glossary term;
  // the compact spine label uses "Profiel(en)". Kept the full form in a sentence.
  'common.sectionWordOne': 'dwarsprofiel',
  'common.sectionWordMany': 'dwarsprofielen',
  // FLAG alt: laaggrens | geologisch contact — the geology module renders
  // "contact" as "laaggrens"; a "geological contact" here is a formation
  // boundary, so "geologisch contact" was chosen literally.
  'common.geologicalContactWordOne': 'stratigrafisch contact',
  'common.geologicalContactWordMany': 'stratigrafische contacten',
  'common.columnWordOne': 'kolom',
  'common.columnWordMany': 'kolommen',
  'common.groupingWordOne': 'groepering',
  'common.groupingWordMany': 'groeperingen',
  'common.listAnd': 'en',
  'common.importedThisSession': '{list} geïmporteerd tijdens deze sessie.',

  // -------------------------------------------------------------------------
  // app
  // -------------------------------------------------------------------------
  'app.backendFailedBody':
    'Het StrixGeo-backendproces is afgesloten voordat het klaar was. Dit wijst meestal op een probleem met de databankverbinding of een crash bij het opstarten.',
  'app.backendUnreachableBody':
    '— opslaan en alle andere wijzigingen zijn niet beschikbaar, en recente acties zijn mogelijk niet bewaard. Herstart de app om opnieuw verbinding te maken.',
  'app.backendRestartingBody':
    'De backend is herstart en de app maakt opnieuw verbinding. Dit duurt even — je werk is veilig in de databank.',
  'app.logFile': 'Logbestand:',
  'app.dxfExported': 'DXF geëxporteerd.',
  'app.dxfExportFailed': 'Kon de DXF niet exporteren.',
  'app.pdfExported': 'PDF geëxporteerd.',
  'app.pdfExportFailed': 'Kon de PDF niet exporteren.',
  'app.plaxis2dExported': 'Plaxis 2D-script geëxporteerd.',
  'app.plaxis2dExportFailed': 'Kon het Plaxis 2D-script niet exporteren.',

  // -------------------------------------------------------------------------
  // welcome — start-screen extras + recovery-prompt copy.
  // welcome.heading translated literally ("Grondmodel"); the EN literal is the
  // stale product name — owner reconciles against app.name "StrixGeo".
  // -------------------------------------------------------------------------
  'welcome.heading': 'Grondmodel',
  'welcome.taglineFull':
    'Open een bestaand projectbestand of maak een nieuw project aan om te beginnen met het importeren en analyseren van data.',
  'welcome.orDivider': 'of',
  'welcome.untitledProject': 'Naamloos project',
  'welcome.openToRestore': 'Open het projectbestand om te herstellen',
  'welcome.fromAge': 'van {age}',
  'welcome.theProject': 'het project',
  'welcome.fileNotFoundFor':
    'Kon het bestand voor {name} niet vinden op {path}. Heb je het verplaatst of hernoemd?',
  'welcome.openFailedNamed':
    'Kon {name} niet openen. Het bestand is mogelijk beschadigd, of de API is niet bereikbaar.',
  'welcome.recoveryTitle': 'Niet-opgeslagen werk herstellen in {name}?',
  'welcome.recoveryIntro':
    'StrixGeo werd onverwacht afgesloten{age}. Een back-up van je niet-opgeslagen werk is bewaard',
  'welcome.recoverySavedUntouched': 'Je opgeslagen project blijft ongewijzigd.',
  'welcome.recoveryRestore': 'Herstellen',
  'welcome.recoveryNotNow': 'Niet nu',
  'welcome.recoveryDeleteBackup': 'Back-up verwijderen',
  'welcome.recoveryRestoreDesc':
    '— zet het niet-opgeslagen werk terug. Er wordt niets naar het bestand opgeslagen tot je in de app op Opslaan klikt.',
  'welcome.recoveryNotNowDesc':
    '— opent het project zoals het laatst is opgeslagen. De back-up wordt bij de volgende start opnieuw aangeboden.',
  'welcome.recoveryDeleteBackupDesc':
    '— alsof de sessie nooit heeft plaatsgevonden: het project keert terug naar de laatste bewaaractie en het niet-opgeslagen werk wordt definitief verwijderd.',
  // FLAG alt: Beoordeling van lithosuggesties | Lithosuggestie-triage — "triage"
  // is a loanword; the alt spells it out. {columnWord} = kolom/kolommen.
  'welcome.recoveryLithoTriage': 'Lithosuggestie-triage op {count} {columnWord}',
  'welcome.recoveryMetadataEdits': 'niet-opgeslagen wijzigingen aan projectgegevens',
  // FLAG alt: de stratigrafische samenvoegingskaart | de stratigrafie-lumpingkaart
  // — internal jargon ("lumping map"); the chosen term translates "lumping" as
  // "samenvoeging". {groupingWord} = groepering/groeperingen.
  'welcome.recoveryLumpingMap': 'de stratigrafie-samenvoegingskaart ({count} {groupingWord})',
  'welcome.recoveryUnsavedMarker': 'de markering voor niet-opgeslagen wijzigingen',

  // -------------------------------------------------------------------------
  // project — new-project blurb, metadata + close copy, discard/revert toasts.
  // -------------------------------------------------------------------------
  'project.newBlurb':
    'Geef nu een naam; rijkere details (opdrachtgever, locatie, labels, standaard-CRSen…) kan je toevoegen via de metadata-editor van het project zodra die er is.',
  'project.createEllipsis': 'Aanmaken…',
  'project.namePlaceholderExample': 'bv. GEO-22/040 Brugge',
  'project.metadataBlurbFull':
    'Bewerk de hoofdgegevens van het project. Wijzigingen worden in één keer opgeslagen in de databank en het .gmproj-bestand.',
  // Removing a tag chip is form editing; "verwijderen" reads right. Since the
  // owner renamed the project-local hide (common.remove) to "Verwijderen" too
  // (2026-09-03), tag removal and the row hide now share the word, which is fine
  // — both are reversible edits; only the irreversible DB delete carries the
  // emphatic "Definitief verwijderen".
  'project.removeTag': '{tag} verwijderen',
  'project.closeConfirmBodyDetailed':
    'wordt gesloten en je keert terug naar het startscherm. Het .gmproj-bestand en je opgeslagen gegevens blijven bewaard — je kan het opnieuw openen via de lijst met recente projecten.',
  'project.closeHintGmproj':
    'Project sluiten — je keert terug naar het startscherm. Het .gmproj-bestand en de gegevens in de databank blijven bewaard.',
  'project.editMetadataHint': 'Klik om projectgegevens te bewerken',
  'project.editMetadataHintWithPath': '{path} — klik om projectgegevens te bewerken',
  'project.revertNotLatest':
    'Kon niet terugdraaien: dit bestand is niet de laatste bewaaractie van het project. De back-up is behouden.',
  'project.revertFailed':
    'Kon het project niet terugdraaien naar de laatste bewaaractie — de back-up is behouden.',
  'project.fileNotFoundToast':
    'Kon het projectbestand niet vinden op {path}. Heb je het verplaatst of hernoemd?',
  'project.restoreWaitingToast':
    'Nog bezig met herstellen… een lopende herberekening van de lichamen kan het project vergrendeld houden (tot 30 s).',
  'project.restoreDroppedToast':
    'Herstel heeft te grote gegevens overgeslagen: {series} diepteseries en {rows} onderliggende gegevensrijen. Zie het logboek.',
  'project.discardLossInterpretation':
    'Koppelingen, verplaatste grenzen, aanvaarde suggesties en verwijderingen van deze sessie, in eender welke stap — deze worden hier niet geteld.',
  'project.discardLossMetadata':
    'Niet-opgeslagen wijzigingen in de metadata-editor van het project.',
  'project.discardLeadSaved':
    'Verwerpen draait het hele project — in de databank, over alle stappen heen — terug naar de laatst bewaarde toestand.',
  'project.discardLeadUnsaved':
    'Dit project is nog nooit naar een bestand opgeslagen, dus Verwerpen heeft geen bewaarde toestand om naar terug te keren.',
  'project.discardFollowSaved': 'Alles wat sinds de laatste Bestand → Opslaan is gedaan, gaat verloren',
  'project.discardFollowUnsaved':
    'Het verwijdert alles wat deze sessie aan het project heeft toegevoegd',
  'project.unsavedTitle': 'Wijzigingen opslaan in {name}?',

  // -------------------------------------------------------------------------
  // shell — toolbar overflow, inspector toggle, split-button menus, theme.
  // -------------------------------------------------------------------------
  'shell.moreToolbarActions': 'Meer werkbalkacties',
  'shell.more': 'Meer',
  'shell.actionWordOne': 'actie',
  'shell.actionWordMany': 'acties',
  // FLAG alt: knoppenrij | werkbalkrij — "verb row" = the row of toolbar verb
  // buttons; "smaller" is coincidentally the Dutch comparative of "smal".
  'shell.moreActionsTitle':
    'nog {n} {actionWord} — de werkbalk is smaller dan de volledige knoppenrij',
  'shell.collapseInspector': 'Detailvenster inklappen',
  'shell.expandInspector': 'Detailvenster uitklappen',
  'shell.clickForOptionsTitle': '{label} — klik voor opties',
  'shell.optionsAria': 'opties voor {label}',
  'shell.themeSystem': 'Systeemthema',
  'shell.themeLight': 'Licht thema',
  'shell.themeDark': 'Donker thema',
  'shell.themeToggleTitle': '{current} (klik voor {next})',
} as const
