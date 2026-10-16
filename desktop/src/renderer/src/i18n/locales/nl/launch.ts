// Dutch (BE) for the launch chrome: onboarding (#93) and the updater
// notification (#6). Mirrors ``locales/en/launch.ts``.
//
// The product name (StrixGeo) is NOT here: it is a product identifier rendered
// as a raw token.

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
    'Het voorbeeldproject zit nog niet in deze prototypebuild. Er wordt een leeg project gestart.',
  'onboarding.sampleLoaded': 'Voorbeeldproject geopend. Opgeslagen als {path}',
  'onboarding.stageImport': 'Importeren',
  'onboarding.stageImportBody': 'Haal sonderingen en boringen binnen uit bestanden of rechtstreeks uit DOV.',
  'onboarding.stageGeology': 'Stratigrafie',
  'onboarding.stageGeologyBody': 'Leg de stratigrafische ruggengraat vast: formaties en hun vlakken.',
  'onboarding.stageLitho': 'Lithologie',
  'onboarding.stageLithoBody': 'Verfijn de ruggengraat tot lithologische eenheden langs je doorsneden.',
  'onboarding.stageGeotech': 'Geotechniek',
  'onboarding.stageGeotechBody': 'Verdeel eenheden in NAD-pakkingsklassen op basis van sondeerindicatoren.',
  'onboarding.stageSections': 'Doorsneden',
  'onboarding.stageSectionsBody':
    'Teken en bewerk doorsneden: het vlak waarop alle drie de modelniveaus worden opgebouwd.',
  'onboarding.stageExport': 'Exporteren',
  'onboarding.stageExportBody': 'Stuur het model naar Plaxis, D-Stability, DXF en PDF-rapportdelen.',

  // updater -----------------------------------------------------------------
  'updater.checking': 'Controleren op updates…',
  'updater.availableTitle': 'Er is een nieuwe versie beschikbaar',
  'updater.availableBody': 'Versie {version} kan worden opgehaald.',
  'updater.download': 'Downloaden',
  'updater.later': 'Straks',
  'updater.downloading': 'Update ophalen… {percent}%',
  'updater.downloadedTitle': 'Update klaar om te installeren',
  'updater.downloadedBody': 'Versie {version} staat klaar. Installeer nu met de knop, of bij de volgende start.',
  'updater.restart': 'Herstarten & installeren',
  'updater.upToDate': 'Je gebruikt al de nieuwste versie.',
  // Nog geen release gepubliceerd (bevinding g): rustig, geen fout.
  'updater.noReleaseYet': 'Nog geen update beschikbaar.',
  'updater.disabled': 'Updates zijn uitgeschakeld tijdens ontwikkeling.',
  'updater.error': 'Controle op updates mislukt.',
  // Een echte fout benoemt de oorzaak (bevinding g).
  'updater.errorOffline': 'Controle op updates mislukt: je lijkt offline te zijn.',
  'updater.errorBlocked': 'Controle op updates mislukt: de verbinding werd geblokkeerd (proxy of firewall).',
  'updater.errorUnexpected': 'Controle op updates onverwacht mislukt.',
  'updater.dismiss': 'Sluiten',
}
