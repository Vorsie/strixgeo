// Instellingenvenster. WIRED: SettingsDialog leest deze sleutels vandaag al.
//
// Part of the Dutch (BE) message catalogue — see 'locales/nl/index.ts'.

export const SETTINGS_NL = {
  'settings.title': 'Instellingen',
  // NOTE: ruled 2026-08-27 — owner chose "Lagenherkenning".
  'settings.section.litho': 'Lagenherkenning',
  'settings.section.geotech': 'Geotechnisch',
  // FLAG alt: Doorsneden | Profielen — see spine.sections. Whatever wins must
  // win everywhere; this is the long form.
  'settings.section.sections': 'Dwarsprofielen',
  'settings.section.appearance': 'Weergave',
  'settings.scope.project': 'Opgeslagen in dit project',
  'settings.scope.device': 'Opgeslagen op dit toestel',
  'settings.needProject': 'Open of maak een project aan om deze instellingen te wijzigen.',
  'settings.resetDefaults': 'Standaardwaarden herstellen',
  'settings.sliderLabel': 'Schuifregelaar {label}',

  'settings.litho.blurb':
    'Afstelling van het werkwoord Voorstellen op de litho-as. Geldt vanaf de volgende keer dat je Voorstellen gebruikt; al aanvaarde eenheden blijven ongewijzigd.',
  'settings.litho.minThickness': 'Minimale laagdikte (m)',
  'settings.litho.minThicknessHint':
    'Lagen die dunner zijn dan deze waarde worden bij hun buur gevoegd, ongeacht de lithologie. Lagere waarden pikken dunne kleisluiers op; hogere waarden geven een grovere kolom. Werkt samen met de schakelaar "Lagen met dezelfde lithologie samenvoegen" hieronder — eerst wordt op dikte samengevoegd, daarna op lithologie. Standaard {default} m.',
  // NOTE: ruled 2026-08-27 — owner chose "Droog volumegewicht".
  'settings.litho.gunsat': 'Droog volumegewicht (kN/m³)',
  'settings.litho.gunsatHint':
    "Wordt gebruikt om σ'v boven de grondwatertafel te berekenen, wat de Robertson Ic en de Dr van zand voedt. Voorlopig één waarde voor de hele site: veen ~12, zand ~18, dicht Quartair ~19. Een γ per grondsoort komt later. Standaard {default}.",
  'settings.litho.drFactor': 'Relatieve dichtheid Dr voor zand',
  'settings.litho.drFactorHint':
    'Compressiefactor van Jamiolkowski in de correlatie voor relatieve dichtheid. 0,675 = gemiddeld kwarts; lager voor kalkhoudende zanden, hoger voor breekbaar veldspaat. De meeste ingenieurs laten dit ongemoeid. Standaard {default}.',
  'settings.litho.mergeSameLithology': 'Lagen met dezelfde lithologie samenvoegen',
  'settings.litho.mergeSameLithologyHint':
    'Opeenvolgende splitsingen met dezelfde lithologie (zand op zand, enz.) worden tot één laag samengevoegd. Splitsingen op pakkingsdichtheid komen terug als voorstellen in de geotechnische stap.',
  'settings.litho.normaliseQc': 'qc normaliseren (Robertson 2015)',
  'settings.litho.normaliseQcHint':
    'Aan (standaard): sonderingen worden geclassificeerd met de spanningsgenormaliseerde Robertson 2015-methode (Qtn / F / Ic), op basis van het volumegewicht en de grondwatertafel hierboven. Uit: de niet-genormaliseerde Robertson 2010-index I_SBT (qc/pa + Rf) — geen spanningsprofiel of grondwater nodig, beter op geringe diepte of wanneer de grondwatertafel onzeker is. In de uit-stand blijven Dr en de NAD-pakking leeg (relatieve dichtheid vergt effectieve spanning). Enkel voor sonderingen.',
  'settings.litho.fillAtSectionLine': 'Vulling op de profiellijn',
  'settings.litho.fillAtSectionLineHint':
    'Aan = de lichamen worden op de profiellijn doorgesneden (standaard, doorlopend); Uit = het model wordt op elke proeflocatie bemonsterd (een strook per proef, ruwe meetwaarde).',
  // NOTE: ruled 2026-08-27 — owner chose "Litho↔geologie snappen".
  'settings.litho.snapTolerance': 'Litho↔geologie snappen (m)',
  'settings.litho.snapToleranceHint':
    'Litho- en geologische grenzen die binnen deze afstand van elkaar liggen, worden als hetzelfde vlak beschouwd — ze worden gekoppeld en klikken samen vast, zodat de ene mee verschuift met de andere. Stuurt ook de vraag bij het slepen. Bereik 0,01–5,0 m.',
  'settings.litho.autoCorrelateWindow': 'Dieptevenster voor autocorrelatie (m)',
  'settings.litho.autoCorrelateWindowHint':
    'Hoeveel twee laaggrenzen op naburige proeven in diepte mogen verschillen en toch nog automatisch gecorreleerd worden (verder versoepeld naargelang de horizontale afstand). Verbreed het om correlaties over hellende lagen mee te nemen; versmal het om losse verbanden te weren. Autocorrelatie koppelt altijd enkel naburige proeven, nooit over een tussenliggende proef heen. Bereik {min}–{max} m. Standaard {default} m.',
  'settings.litho.openExtentLength': 'Lengte van de open uitbreiding (m)',
  'settings.litho.openExtentLengthHint':
    'Hoe ver een open lichaamsuitbreiding (een lichaam op de buitenste proef zonder buur aan die kant) voorbij de proef doorloopt, in plaats van tot de rand van het profiel. Bereik {min}–{max} m. Standaard {default} m.',
  'settings.litho.voxelHeading': 'Voxelgrootte',
  'settings.litho.voxelBlurb':
    'Celafmetingen die de knop "Model bouwen" in de lithologiestap gebruikt om de 3D-ruimte te labelen op basis van de profielverdelingen.',
  'settings.litho.voxelHorizontal': 'Horizontale cel (X/Y) (m)',
  'settings.litho.voxelHorizontalHint':
    'Voxelgrootte in het kaartvlak (X/Y). De geologie verandert horizontaal traag, dus dit mag grof blijven. Kleinere waarden maken de zijranden van lichamen scherper, tegen een kwadratisch stijgend aantal voxels. Bereik {min}–{max} m. Standaard {default} m.',
  'settings.litho.voxelVertical': 'Verticale cel (Z) (m)',
  'settings.litho.voxelVerticalHint':
    'Voxelgrootte in de hoogte. Een fijne Z pikt dunne lagen op — een veenlaagje of een zandlens — die een grof raster mist. Maar het vermenigvuldigt de rekentijd: 0,5 m geeft ruwweg 4× zoveel voxels (en minuten rekentijd) als een kubisch raster van 2 m, dus grijp er enkel naar wanneer dunne lagen ertoe doen. Bereik {min}–{max} m. Standaard {default} m.',
  // v2 is de STANDAARDENGINE (gemeten omschakeling 2026-08-01; eigenaar
  // 2026-08-27: "dit is niet meer experimenteel maar de main engine") — de
  // schakelaar bestaat enkel nog als terugvalhendel naar v1.
  'settings.litho.engineV2': 'Verdelingssoftware v2',
  'settings.litho.engineV2Hint':
    'De hoofdsoftware: trekt gesloten contouren na en tekent de 2D-vulling, de 3D-opbouw en het hekkendiagram. Uit = terugvallen op de oude v1-software (enkel voor probleemanalyse). Wordt op dit toestel bewaard (reist niet mee met het project).',
  'settings.litho.engineV2Status':
    'Actieve software: {engine} — meteen toegepast; de knop Opslaan hieronder is voor deze regel niet nodig.',
  'settings.litho.engineV2Name': 'v2 (gesloten contouren)',
  'settings.litho.engineV1Name': 'v1 (oude terugval)',

  'settings.geotech.blurb':
    'Afstelling van de NAD-pakkingsonderverdeling ("Alle lichamen onderverdelen"). Geldt vanaf de volgende keer dat je Onderverdelen gebruikt; al onderverdeelde lichamen blijven ongewijzigd.',
  'settings.geotech.minThickness': 'Min. laagdikte (m)',
  'settings.geotech.minThicknessHint':
    'De dunste NAD-pakkingsband die bewaard blijft; tevens de afstand waarover een verandering in qc moet aanhouden om een grens te verleggen (dunnere dips en pieken worden genegeerd). Bereik {min}–{max} m. Standaard {default} m.',
  // NOTE: ruled 2026-08-27 — owner chose "Vastklikken op qc-sprong".
  'settings.geotech.gradientSnap': 'Vastklikken op qc-sprong',
  'settings.geotech.gradientSnapHint':
    'Klik een grens vast op een nabije scherpe sprong in qc voor meer precisie; verschuift de grens nooit naar een minder conservatieve diepte.',
  'settings.geotech.gradientSnapWindow': 'Venster voor vastklikken op gradiënt (m)',
  'settings.geotech.gradientSnapWindowHint':
    'Hoe ver een grens mag vastklikken op een scherpe sprong. Bereik {min}–{max} m. Standaard {default} m.',

  'settings.sections.blurb':
    'Standaardwaarden voor een nieuw dwarsprofiel dat je tekent. Bestaande profielen behouden de waarden waarmee ze aangemaakt zijn — die pas je aan in de profielkop.',
  'settings.sections.buffer': 'Standaard projectiebuffer (m)',
  'settings.sections.bufferHint':
    'Halve breedte van de strook rond de profiellijn; grondonderzoek binnen ±buffer wordt op het profiel geprojecteerd. Krappe funderingsvlakken ~15 m, havenstudies 50-100 m. Standaard {default} m.',
  'settings.sections.vex': 'Standaard verticale overdrijving',
  'settings.sections.vexHint':
    'Verhouding tussen verticale en horizontale schaal. 1× is meetkundig correct; 2-5× maakt dunne lagen leesbaar op regionale schaal. Standaard {default}×.',
  // FLAG alt: Tolerantie langs de strekking voor koppelprofielen — a "tie-section"
  // is a cross-section drawn to tie two others together. "Koppelprofiel" is a
  // coinage; there is no BE-standard term.
  'settings.sections.tieTolerance': 'Strekkingstolerantie koppelprofiel (m)',
  'settings.sections.tieToleranceHint':
    'Hoe ver twee proeven langs de strekking uit elkaar mogen liggen en toch nog in hetzelfde automatisch voorgestelde koppelprofiel terechtkomen. Ruimer = meer koppelingen, maar minder zuiver.',

  'settings.appearance.blurb':
    'Voorkeuren per toestel. Deze blijven op deze machine staan en reizen NIET mee met het .strix-bestand.',
  'settings.appearance.theme': 'Thema',
  'settings.appearance.themeSystem': 'Systeem (volgt het besturingssysteem)',
  'settings.appearance.themeLight': 'Licht',
  'settings.appearance.themeDark': 'Donker',
  'settings.appearance.themeHint':
    'Systeem volgt de voorkeur van het besturingssysteem en past zich meteen aan wanneer je de donkere modus van Windows/macOS omzet. Kies hier een thema om het vast te zetten.',
  'settings.appearance.language': 'Taal van de interface',
  'settings.appearance.languageHint':
    'Wordt meteen overal toegepast. Meetgegevens behouden de bewoording van hun bron — grondsoorten, NAD-pakkingsklassen en DOV-codes worden in elke taal getoond zoals ze geregistreerd zijn.',
} as const
