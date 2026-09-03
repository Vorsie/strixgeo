// Dutch (BE) for the launch-prototype chrome — onboarding (#93), licensing (#3)
// and the updater notification (#6). Mirrors ``locales/en/launch.ts``.
//
// Product + tier names (StrixGeo, Solo, Pro, Studio) and the demo licence keys
// are NOT here — they are product identifiers rendered as raw tokens.

import type { LAUNCH } from '../en/launch'

export const LAUNCH_NL: Partial<Record<keyof typeof LAUNCH, string>> = {
  // onboarding --------------------------------------------------------------
  'onboarding.welcomeTitle': 'Welkom bij StrixGeo',
  'onboarding.welcomeBody':
    'StrixGeo maakt van sondeer- en boorgegevens een gevalideerd grondmodel dat je rechtstreeks naar je rekentools exporteert.',
  'onboarding.chooseTitle': 'Hoe wil je beginnen?',
  'onboarding.sampleTitle': 'Voorbeeldproject laden',
  'onboarding.sampleBody': 'Open een afgewerkt grondmodel en verken de volledige werkwijze.',
  'onboarding.scratchTitle': 'Van nul beginnen',
  'onboarding.scratchBody': 'Maak een leeg project en importeer je eigen gegevens.',
  'onboarding.tourTitle': 'Een korte rondleiding',
  'onboarding.tourIntro': 'Zes stappen brengen ruwe gegevens naar een eindproduct. Dit doet elke stap.',
  'onboarding.stepCount': 'Stap {current} van {total}',
  'onboarding.skip': 'Overslaan',
  'onboarding.back': 'Terug',
  'onboarding.next': 'Volgende',
  'onboarding.done': 'Aan de slag',
  // Start-de-tutorial-scherm (vervangt de oude stappen-slideshow).
  'onboarding.startTitle': 'Klaar om te bouwen?',
  'onboarding.startBody':
    'Een korte, praktische tutorial leidt je door de volledige workflow op je eigen project, knop per knop. Sla ze altijd over en heropen ze via Help.',
  'onboarding.startTutorial': 'Start de tutorial',
  'onboarding.startLater': 'Misschien later',
  'onboarding.sampleUnavailable':
    'Het voorbeeldproject zit nog niet in deze prototypebuild — er wordt een leeg project gestart.',
  'onboarding.sampleLoaded': 'Voorbeeldproject geopend. Opgeslagen als {path}',
  'onboarding.stageImport': 'Importeren',
  'onboarding.stageImportBody': 'Haal sonderingen en boringen binnen uit bestanden of rechtstreeks uit DOV.',
  'onboarding.stageGeology': 'Geologie',
  'onboarding.stageGeologyBody': 'Leg de geologische ruggengraat vast — formaties en hun vlakken.',
  'onboarding.stageLitho': 'Lithologie',
  'onboarding.stageLithoBody': 'Verfijn de ruggengraat tot lithologische eenheden langs je doorsneden.',
  'onboarding.stageGeotech': 'Geotechniek',
  'onboarding.stageGeotechBody': 'Verdeel eenheden in NAD-pakkingsklassen op basis van sondeerindicatoren.',
  'onboarding.stageSections': 'Doorsneden',
  'onboarding.stageSectionsBody':
    'Teken en bewerk doorsneden — het vlak waarop alle drie de modelniveaus worden opgebouwd.',
  'onboarding.stageExport': 'Exporteren',
  'onboarding.stageExportBody': 'Stuur het model naar Plaxis, D-Stability, DXF en PDF-rapportdelen.',

  // licensing ---------------------------------------------------------------
  'licensing.title': 'Licentie & activatie',
  'licensing.statusHeading': 'Toestand',
  'licensing.deviceHeading': 'Dit toestel',
  'licensing.tierLabel': 'Niveau',
  'licensing.expiresLabel': 'Verlengt / eindigt',
  'licensing.stateUnactivated': 'Niet geactiveerd',
  'licensing.stateTrial': 'Proefperiode',
  'licensing.stateActive': 'Actief',
  'licensing.stateGrace': 'Offline-respijt',
  'licensing.stateExpired': 'Verlopen',
  'licensing.stateClockRollback': 'Klokprobleem',
  'licensing.stateDeviceMismatch': 'Verkeerd apparaat',
  'licensing.daysRemaining': 'nog {days} dag(en)',
  'licensing.graceRemaining': 'nog {days} dag(en) offline-respijt',
  'licensing.enterKey': 'Voer een licentiesleutel in',
  'licensing.activate': 'Activeren',
  'licensing.startTrial': 'Gratis proefperiode starten',
  'licensing.deactivate': 'Dit toestel deactiveren / overdragen',
  'licensing.deactivateHint': 'Maakt deze zetel vrij zodat je op een ander toestel kunt activeren.',
  // Bevestigingsvenster voor het onomkeerbare deactiveren / overdragen (docs/ux.md).
  'licensing.deactivateConfirmTitle': 'Dit toestel deactiveren?',
  'licensing.deactivateConfirmBody':
    'Dit maakt de zetel vrij zodat je op een ander toestel kunt activeren. De app keert terug naar het activatiescherm.',
  'licensing.deactivateConfirmAction': 'Deactiveren',
  'licensing.demoKeysHint': 'Demosleutels voor het prototype: STRIX-SOLO-DEMO, STRIX-PRO-DEMO, STRIX-STUDIO-DEMO.',
  'licensing.previewHeading': 'Een toestand bekijken (enkel prototype)',
  'licensing.errorUnknownKey': 'Die licentiesleutel is niet herkend.',
  'licensing.errorDeviceLimit':
    'Deze sleutel is al actief op een ander toestel. Deactiveer hem daar of draag de zetel over.',
  'licensing.errorAlreadyTrialled': 'Dit toestel heeft zijn gratis proefperiode al gebruikt.',
  'licensing.errorUnreachable': 'De activatieserver was niet bereikbaar.',
  'licensing.toastActivated': 'Licentie geactiveerd.',
  'licensing.toastTrialStarted': 'Gratis proefperiode gestart.',
  'licensing.toastDeactivated': 'Dit toestel is gedeactiveerd.',

  // updater -----------------------------------------------------------------
  'updater.checking': 'Controleren op updates…',
  'updater.availableTitle': 'Er is een nieuwe versie beschikbaar',
  'updater.availableBody': 'Versie {version} kan worden opgehaald.',
  'updater.download': 'Downloaden',
  'updater.later': 'Straks',
  'updater.downloading': 'Update ophalen… {percent}%',
  'updater.downloadedTitle': 'Update klaar om te installeren',
  'updater.downloadedBody': 'Versie {version} wordt toegepast wanneer je herstart.',
  'updater.restart': 'Herstarten & installeren',
  'updater.upToDate': 'Je gebruikt al de nieuwste versie.',
  'updater.disabled': 'Updates zijn uitgeschakeld tijdens ontwikkeling.',
  'updater.error': 'Controle op updates mislukt.',
  'updater.dismiss': 'Sluiten',
}
