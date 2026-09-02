// Dutch (BE) for the guided tutorial (debt #93, owner ruling 24). Mirrors
// ``locales/en/tutorial.ts``.
//
// ⚠ ALL wording here is a DRAFT for the owner's review — professional Flemish
// geotechnical register, but the owner writes BE and has final say. Domain nouns
// follow the app's existing NL catalogue (Sondering (CPT), Boring, Dwarsprofiel,
// Zaaien/Bouwen, geologie-as) rather than a second spelling. Product names
// (StrixGeo, DOV, Plaxis, D-Stability, DXF, NAD, EPSG, TAW, NAP) stay raw tokens.

import type { TUTORIAL } from '../en/tutorial'

export const TUTORIAL_NL: Partial<Record<keyof typeof TUTORIAL, string>> = {
  // Chapter titles ----------------------------------------------------------
  'tutorial.chapter.1': 'Je project',
  'tutorial.chapter.2': 'Data importeren',
  'tutorial.chapter.3': 'Dwarsprofielen',
  'tutorial.chapter.4': 'Geologisch model',
  'tutorial.chapter.5': 'Lithostratigrafisch model',
  'tutorial.chapter.6': 'Geotechnisch model',
  'tutorial.chapter.7': 'Parameters & statistiek',
  'tutorial.chapter.8': 'Exporteren',

  // Coach-card chrome -------------------------------------------------------
  'tutorial.ui.back': 'Terug',
  'tutorial.ui.next': 'Volgende',
  'tutorial.ui.skipStep': 'Stap overslaan',
  'tutorial.ui.skipTutorial': 'Tutorial overslaan',
  'tutorial.ui.finish': 'Afronden',
  'tutorial.ui.watchClip': 'Bekijk het filmpje',
  'tutorial.ui.progress': 'Hoofdstuk {chapter} van {chapterCount} · Stap {step} van {stepCount}',
  'tutorial.ui.doItHint': 'Doe dit in de app — de tutorial gaat vanzelf verder zodra je het doet.',
  'tutorial.ui.openTab': 'Open het gemarkeerde tabblad om deze knop te vinden.',
  'tutorial.ui.offscreen': 'De knop is nu niet zichtbaar — de tip blijft hier staan tot ze verschijnt.',

  // 1 · Je project ----------------------------------------------------------
  'tutorial.project-name.title': 'Geef je project een naam',
  'tutorial.project-name.body':
    'Elk project begint met een naam. Kies iets dat je later herkent — je dossiernummer en de locatie, zoals GEO-22/040 Brugge. Klant, fase en andere gegevens voeg je nadien toe.',
  'tutorial.project-create.title': 'Maak het project aan',
  'tutorial.project-create.body':
    'Klik op Project aanmaken om het te openen. Vanaf hier leeft elke sondering, boring, dwarsprofiel en model in dit project en wordt het mee opgeslagen.',
  'tutorial.project-crs.title': 'Stel het coördinatensysteem in',
  'tutorial.project-crs.body':
    'Open de projectgegevens en kies het horizontale CRS: Lambert 72 (EPSG 31370) voor België, RD New (EPSG 28992) voor Nederland. Het moet overeenkomen met hoe je data is ingemeten, anders belandt elke locatie op de verkeerde plek.',
  'tutorial.project-datum.title': 'Stel het hoogtereferentievlak in',
  'tutorial.project-datum.body':
    'Het hoogtereferentievlak is het nulpunt waartegen elke hoogte wordt gemeten — TAW in België, NAP in Nederland. Kies het vlak dat je peilen gebruiken zodat dieptes en maaiveldhoogtes overal correct worden weergegeven.',

  // 2 · Importeren ----------------------------------------------------------
  'tutorial.import-open.title': 'Het importmenu',
  'tutorial.import-open.body':
    'Hier komt data binnen. Open het om te zien welke importmogelijkheden StrixGeo vandaag biedt — sonderingen en boringen, uit lokale bestanden of rechtstreeks uit DOV.',
  'tutorial.import-cpt-dov.title': 'Sonderingen importeren uit DOV',
  'tutorial.import-cpt-dov.body':
    "Kies 'Sondering (CPT) importeren uit DOV' en teken een kader op de kaart. Elke sondering die DOV binnen dat kader heeft, stroomt binnen met haar diepteserie en locatie. Deze stap vinkt zichzelf af zodra je eerste sondering binnen is.",
  'tutorial.import-filter-date.title': 'Filter op datum',
  'tutorial.import-filter-date.body':
    'Lange lijsten worden onhandig. Stel een datumbereik in om enkel de onderzoeken uit de betreffende periode te tonen, en wis het om ze weer allemaal te zien.',
  'tutorial.import-filter-type.title': 'Filter op proeftype',
  'tutorial.import-filter-type.body':
    'Schakel hier tussen sonderingen en boringen. Elk tabblad toont enkel dat type onderzoek, zodat je één type per keer kunt afwerken.',
  'tutorial.import-hide.title': 'Een proef verbergen',
  'tutorial.import-hide.body':
    'Niet elke sondering hoort in je dataset. Verwijder er een om ze uit dit project te verbergen — een omkeerbare, projectlokale verberging die je altijd kunt herstellen. De data zelf wordt nooit gewist.',
  'tutorial.import-borehole-dov.title': 'Boringen importeren uit DOV',
  'tutorial.import-borehole-dov.body':
    "Boringen komen op dezelfde manier binnen: kies 'Boring importeren uit DOV' en teken een kader op de kaart. Deze stap vinkt af zodra je eerste boring binnen is.",
  'tutorial.import-gef.title': 'Lokale GEF-bestanden importeren',
  'tutorial.import-gef.body':
    "Sonderingen op schijf? 'Sondering (CPT) importeren (.gef)' leest standaard GEF-bestanden rechtstreeks van je computer — handig voor sonderingen die niet in DOV zitten.",
  'tutorial.import-more.title': 'Meer bronnen op komst',
  'tutorial.import-more.body':
    "DMT, labproeven en monitoringdata staan op de planning — voorlopig zie je ze in het menu met de vermelding 'Phase 4'.",
  'tutorial.import-closing.title': 'Een ander formaat nodig?',
  'tutorial.import-closing.body':
    'Er komen meer importfuncties, afhankelijk van wat je nodig hebt — stuur de bestandsformaten die je gebruikt naar StrixGeo en wij bouwen de parser.',

  // 3 · Dwarsprofielen ------------------------------------------------------
  'tutorial.section-create.title': 'Maak een dwarsprofiel aan',
  'tutorial.section-create.body':
    'Een dwarsprofiel is waar je alle drie de modellen bouwt en bewerkt. Maak je eerste aan — teken de lijn door de onderzoeken die je wilt correleren. Deze stap vinkt af zodra er een dwarsprofiel bestaat.',
  'tutorial.section-buffer.title': 'Projectiebuffer',
  'tutorial.section-buffer.body':
    'De buffer is hoe ver een proef aan weerszijden van de profiellijn mag liggen om er nog op geprojecteerd te worden. Verbreed hem om meer sonderingen mee te nemen, versmal hem om enkel die op de lijn te houden.',
  'tutorial.section-spacing.title': 'Kolomafstand',
  'tutorial.section-spacing.body':
    'De afstand spreidt de geprojecteerde kolommen uit zodat overlappende proeven elkaar niet langer verbergen. Bij 0% staat elke proef op haar echte positie langs het profiel; hogere waarden ruilen dat in voor leesbaarheid.',
  'tutorial.section-vexag.title': 'Verticale overhoging',
  'tutorial.section-vexag.body':
    'De ondergrond is veel breder dan diep, dus dunne lagen verdwijnen op ware schaal. Verticale overhoging rekt de diepteas uit om ze leesbaar te maken — enkel de tekening wordt uitgerekt, de getallen blijven echt.',
  'tutorial.section-channels.title': 'CPT-datakanalen',
  'tutorial.section-channels.body':
    'Schakel de CPT-curven — qc, Rf, fs, u2 en qT — om enkel te tonen wat je afleest. Minder kanalen geeft een overzichtelijkere kolom bij het correleren van lagen.',
  'tutorial.section-boreholes.title': 'Boringstromen',
  'tutorial.section-boreholes.body':
    'Boringen kunnen meerdere interpretatiestromen naast elkaar tonen. Zet elke stroom aan of uit — elke actieve stroom tekent als een eigen strook naast de sonderingen.',
  'tutorial.section-axis.title': 'Modelas',
  'tutorial.section-axis.body':
    'Hetzelfde profiel bewerkt alle drie de niveaus. Wissel de as tussen Geologie, Litho en Geotech om elk model op zijn beurt te bewerken zonder het profiel te verlaten.',
  'tutorial.section-snap.title': 'Kleven aan stratigrafie',
  'tutorial.section-snap.body':
    'Met de Snap-knop aan belandt een klik vlak bij een gelogde grens er exact op, in plaats van een pixel ernaast. Zo blijven je grenzen verbonden met de stratigrafie die de boringen echt registreren.',
  'tutorial.section-dem.title': 'Het maaiveld',
  'tutorial.section-dem.body':
    'De grijze lijn bovenaan is het maaiveld uit het DEM, automatisch getekend overal waar de maaiveldhoogte bekend is. Het is de referentie waaraan je hoogtes hangen.',
  'tutorial.section-persist.title': 'Je weergave wordt bewaard',
  'tutorial.section-persist.body':
    'Elke instelling hier — buffer, afstand, overhoging, kanalen, snap — wordt vanzelf bij dit dwarsprofiel bewaard. Heropen het en de kadrering staat exact zoals je ze achterliet; Reset zet de standaardweergave terug.',

  // 4 · Geologisch model (skelet) -------------------------------------------
  'tutorial.geo-open.title': 'Open de Geologie-stap',
  'tutorial.geo-open.body': 'Het geologisch model is de ruggengraat — de formaties en de vlakken ertussen.',
  'tutorial.geo-seed.title': 'Zaaien vanuit boringen',
  'tutorial.geo-seed.body': 'Zaai de eerste contacten van het model vanuit je boringen, op basis van de formatietoppen die ze loggen.',
  'tutorial.geo-lumping.title': 'Zelfde eenheid, andere naam',
  'tutorial.geo-lumping.body': 'Vertel het model dat twee eenheden dezelfde zijn door de stratigrafie samen te voegen tot één formatie.',
  'tutorial.geo-surfaces.title': 'Bouw de vlakken',
  'tutorial.geo-surfaces.body': 'Herbouw de formatievlakken en controleer waar ze elkaar kruisen.',

  // 5 · Lithostratigrafisch model (skelet) ----------------------------------
  'tutorial.litho-open.title': 'Open de Lithologie-stap',
  'tutorial.litho-open.body': 'Verfijn de geologische ruggengraat tot lithologische eenheden langs je profielen.',
  'tutorial.litho-accept.title': 'Aanvaard de voorstellen',
  'tutorial.litho-accept.body': 'De segmenter stelt lithologische lagen voor op elke kolom; aanvaard die welke overeenkomen met wat je ziet.',
  'tutorial.litho-build.title': 'Bouw de lithobodies',
  'tutorial.litho-build.body': 'Bouwen zet de aanvaarde lagen om in verbonden 3D-lithobodies.',

  // 6 · Geotechnisch model (skelet) -----------------------------------------
  'tutorial.geotech-open.title': 'Open de Geotechniek-stap',
  'tutorial.geotech-open.body': 'Verdeel de lithologische eenheden in NAD-pakkingsklassen op basis van CPT-afgeleide indicatoren.',
  'tutorial.geotech-subdivide.title': 'Doorloop de pakkingspijplijn',
  'tutorial.geotech-subdivide.body': 'Verdeel de sonderingen om het geotechnisch model te bouwen — elke eenheid opgesplitst in haar pakkingsklassen.',
  'tutorial.geotech-bodies.title': 'Correleren en herberekenen',
  'tutorial.geotech-bodies.body': "Herbereken de bodies en gebruik daarna Voeg samen of Scheiden waar twee massa's wel of niet dezelfde body zijn.",

  // 7 · Parameters & statistiek (skelet) ------------------------------------
  'tutorial.params-open.title': 'Open de Parameters-stap',
  'tutorial.params-open.body': 'De eenhedenboom, de statistiek per eenheid en de fence-uitsnede vind je hier.',
  'tutorial.params-stats.title': 'Statistiek per eenheid',
  'tutorial.params-stats.body': 'Kies een eenheid om haar statistiek te zien, samengevoegd over elke body die erbij hoort.',

  // 8 · Exporteren (skelet) -------------------------------------------------
  'tutorial.export-open.title': 'Open de Export-stap',
  'tutorial.export-open.body': 'Stuur het afgewerkte model met drie niveaus naar je ontwerptools.',
  'tutorial.export-dxf.title': 'Exporteer je model',
  'tutorial.export-dxf.body': 'Exporteer een dwarsprofiel naar DXF, Plaxis, D-Stability / D-Sheet, of een PDF-rapportblad.',
  'tutorial.closing.title': 'Je bent klaar',
  'tutorial.closing.body':
    'Dat is de volledige workflow — importeren, dwarsprofiel, geologie, litho, geotech, parameters, export. Bouw je eerste model en laat ons weten wat je daarna nodig hebt.',
}
