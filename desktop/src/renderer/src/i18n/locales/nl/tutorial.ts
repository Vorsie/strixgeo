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
  'tutorial.chapter.4': 'Stratigrafisch model',
  'tutorial.chapter.5': 'Lithologisch model',
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
  'tutorial.project-metadata.title': 'Open de projectgegevens',
  'tutorial.project-metadata.body':
    'Je coördinatensysteem en hoogtereferentievlak vind je bij de projectgegevens. Klik op de projectnaam bovenaan het venster om ze te openen — hetzelfde paneel waar je later de opdrachtgever, locatie en labels bewerkt.',
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
    'Een dwarsprofiel is waar je alle drie de modellen bouwt en bewerkt. Maak je eerste aan — teken de lijn door de onderzoeken die je wilt correleren. Zodra het opent, dubbelklik een kolom om die proef in detail te bekijken. Deze stap vinkt af zodra er een dwarsprofiel bestaat.',
  'tutorial.section-buffer.title': 'Projectiebuffer',
  'tutorial.section-buffer.body':
    'De buffer is hoe ver een proef aan weerszijden van de profiellijn mag liggen om er nog op geprojecteerd te worden. Verbreed hem om meer sonderingen mee te nemen, versmal hem om enkel die op de lijn te houden.',
  'tutorial.section-spacing.title': 'Kolomafstand',
  'tutorial.section-spacing.body':
    'De afstand spreidt de geprojecteerde kolommen uit zodat overlappende proeven elkaar niet langer verbergen. Bij 0% staat elke proef op haar echte positie langs het profiel; hogere waarden ruilen dat in voor leesbaarheid.',
  'tutorial.section-vexag.title': 'Verticale overdrijving',
  'tutorial.section-vexag.body':
    'De ondergrond is veel breder dan diep, dus dunne lagen verdwijnen op ware schaal. Verticale overdrijving rekt de diepteas uit om ze leesbaar te maken — enkel de tekening wordt uitgerekt, de getallen blijven echt.',
  'tutorial.section-channels.title': 'CPT-datakanalen',
  'tutorial.section-channels.body':
    'Schakel de CPT-curven — qc, Rf, fs, u2 en qT — om enkel te tonen wat je afleest. Minder kanalen geeft een overzichtelijkere kolom bij het correleren van lagen.',
  'tutorial.section-boreholes.title': 'Interpretatiestromen van de boring',
  'tutorial.section-boreholes.body':
    'Een boring kan meerdere interpretatiestromen dragen. Schakel Geo (geotechnische codering), F-Strat (formele stratigrafie) en I-Strat (informele stratigrafie) naast de sondeerkanalen — elke stroom die je aanzet, tekent als een eigen strook naast de boring. Geo staat standaard aan.',
  'tutorial.section-axis.title': 'Modelas',
  'tutorial.section-axis.body':
    'Hetzelfde profiel bewerkt alle drie de niveaus. Wissel de as tussen Stratigrafie, Litho en Geotech om elk model op zijn beurt te bewerken zonder het profiel te verlaten.',
  'tutorial.section-snap.title': 'Kleven aan stratigrafie',
  'tutorial.section-snap.body':
    'Met de Snap-knop aan belandt een klik vlak bij een gelogde grens er exact op, in plaats van een pixel ernaast. Zo blijven je grenzen verbonden met de stratigrafie die de boringen echt registreren.',
  'tutorial.section-dem.title': 'Het maaiveld',
  'tutorial.section-dem.body':
    'De grijze lijn bovenaan is het maaiveld uit het DEM, automatisch getekend overal waar de maaiveldhoogte bekend is. Het is de referentie waaraan je hoogtes hangen.',
  'tutorial.section-persist.title': 'Je weergave wordt bewaard',
  'tutorial.section-persist.body':
    'Zoom in en uit met de plus- en minknoppen; de schaal-uitlezing toont de exacte horizontale en verticale schaal. Elke instelling hier (buffer, afstand, overdrijving, kanalen, snap, zoom) wordt vanzelf bij dit dwarsprofiel bewaard, dus heropenen zet de kadrering terug; Reset zet de standaardweergave terug en de X sluit het profiel.',
  'tutorial.section-undo.title': 'Ongedaan maken',
  'tutorial.section-undo.body':
    'Ongedaan maken loopt terug door je modelbewerkingen, ook een aanvaarde litholaag. Het zit ook op Ctrl+Z; de knop maakt de stapel zichtbaar.',
  'tutorial.section-tie.title': 'Profielen koppelen',
  'tutorial.section-tie.body':
    'Met meer dan een profiel stelt Koppelprofielen voorstellen korte koppelingen voor waar ze elkaar kruisen, en de caret aanvaardt ze in een keer. De koppelingen geven de 3D-bouw gegevens om tussen je lijnen te interpoleren.',
  'tutorial.section-delete.title': 'Een dwarsprofiel verwijderen',
  'tutorial.section-delete.body':
    'Verwijderen haalt het geselecteerde dwarsprofiel weg. Het is onomkeerbaar, dus het vraagt altijd eerst bevestiging; de onderliggende sonderingen en boringen blijven ongemoeid.',
  'tutorial.section-export.title': 'Dit profiel exporteren',
  'tutorial.section-export.body':
    'Het Export-menu stuurt het open profiel naar DXF, naar Plaxis, naar D-Stability of D-Sheet, of naar een PDF-blad. Elk bestand draagt het modelniveau van de actieve as. De Export-stap verzamelt dezelfde bestemmingen op een plek.',
  'tutorial.section-inspector.title': 'Het profielpaneel',
  'tutorial.section-inspector.body':
    'Het rechterpaneel toont je dwarsprofielen en draagt de modelacties voor de open as: Bouw de vlakken, Vul contacten vanuit de stratigrafie, en Ontdubbelen. Het is de pendant van de werkbalkacties.',

  // 4 · Geologisch model ----------------------------------------------------
  'tutorial.geo-open.title': 'Open de Stratigrafie-stap',
  'tutorial.geo-open.body':
    'Het stratigrafisch model is de ruggengraat van het grondmodel. Het bevat de formaties en de vlakken ertussen, de regionale lagen onder je hele terrein. Bouw dit eerst; het litho- en het geotechnisch model verfijnen het van daaruit.',
  'tutorial.geo-seed.title': 'Vullen vanuit boringen',
  'tutorial.geo-seed.body':
    'Vul de eerste contacten van het model vanuit je boringen. Deze knop leest de formatietoppen die de boringen loggen en plaatst een contact op elke top. Deze stap vinkt zichzelf af zodra de eerste contacten verschijnen.',
  'tutorial.geo-lumping.title': 'Zelfde eenheid, andere naam',
  // FLAG alt: van daaruit worden de contacten op de sonderingen doorgetrokken — "extract the contacts to the CPT columns" phrasing is a judgement call
  'tutorial.geo-lumping.body':
    'Soms zijn twee gelogde eenheden dezelfde formatie onder een andere naam. Voeg de stratigrafie samen om het model te vertellen dat ze één zijn. Van daaruit bereiken de contacten ook de sonderingskolommen, zodat het hele profiel als één geheel leest. Deze stap vinkt af zodra er een samenvoeging bestaat.',
  'tutorial.geo-second-section.title': 'Teken een tweede dwarsprofiel',
  'tutorial.geo-second-section.body':
    'Voor je de vlakken bouwt, teken je een tweede dwarsprofiel over het terrein. Eén lijn geeft elk vlak maar één doorsnede; een tweede lijn geeft het de 3D-gegevens om ertussen te interpoleren. Teken het op dezelfde manier als het eerste.',
  'tutorial.geo-surfaces.title': 'Bouw de vlakken',
  'tutorial.geo-surfaces.body':
    'Bouw de formatievlakken vanuit de contacten. StrixGeo legt één vlak door elke formatietop. Controleer daarna de kruisingen die de validatie meldt, want de formaties moeten op volgorde blijven om het model geldig te houden.',

  // 5 · Lithostratigrafisch model -------------------------------------------
  'tutorial.litho-open.title': 'Open de Lithologie-stap',
  'tutorial.litho-open.body':
    'Het lithologisch model verfijnt de stratigrafische ruggengraat tot lithologische eenheden. Denk aan zand, klei, silt, grind en veen, met hun bijmengingen. Je bouwt het langs je dwarsprofielen, kolom per kolom.',
  'tutorial.litho-create.title': 'Maak een lithomodel aan',
  'tutorial.litho-create.body':
    'Het lithomodel is een aparte grondmodel-as onder het stratigrafische. Maak het eerst aan — zolang het niet bestaat, is er niets om litholaaggrenzen op te kiezen. Geef het een naam en het wordt het actieve lithomodel.',
  'tutorial.litho-axis.title': 'Schakel naar de litho-as',
  'tutorial.litho-axis.body':
    'Open een dwarsprofiel en zet de as op Litho. Hetzelfde profiel bewerkt nu het lithomodel in plaats van de stratigrafie — elk voorstel en elke correlatie die je hier maakt, hoort bij het lithomodel.',
  'tutorial.litho-accept.title': 'Aanvaard de voorstellen',
  'tutorial.litho-accept.body':
    'De segmenter stelt lithologische lagen voor op elke kolom en leest de sondering met een Robertson-classificatie. Aanvaard die welke overeenkomen met wat je ziet. Dit is ondersteund werk, geen automatische correlatie, dus jij houdt elke laag in de hand. Deze stap vinkt af zodra je je eerste voorstel aanvaardt.',
  'tutorial.litho-adjust.title': 'Lagen samenvoegen en bijstellen',
  'tutorial.litho-adjust.body':
    'Aanvaarde lagen kan je verfijnen. Sleep een grens om ze te verplaatsen; Shift+slepen voorbij het midden van de buur neemt die op; Alt+slepen kopieert de samenstelling van een laag naar een andere kolom; rechtsklik een laag voor “Lagen samenvoegen” en meer.',
  'tutorial.litho-correlate.title': 'Correleer de lagen',
  'tutorial.litho-correlate.body':
    'Voor je bouwt, correleer je een laag op de ene kolom met dezelfde laag op de volgende, zodat het model weet dat ze één lichaam zijn. Correleren bovenaan de lithowerkbalk activeert het gebaar met twee klikken; Automatisch correleren stelt de koppelingen over het hele model voor, die je dan aanvaardt.',
  'tutorial.litho-second-section.title': 'Een tweede profiel voor 3D',
  'tutorial.litho-second-section.body':
    'Net als bij de stratigrafie draagt één profiel maar één doorsnede. Teken een tweede dwarsprofiel zodat de litholichamen de 3D-gegevens hebben om over je profielen heen te verbinden.',
  // FLAG alt: lithobodies | 3D-bodies — de gepubliceerde models-catalogus gebruikt "lichamen"; het skelet gebruikte "lithobodies"
  'tutorial.litho-build.title': 'Bouw de litholichamen',
  'tutorial.litho-build.body':
    'Bouwen zet de aanvaarde, gecorreleerde lagen om in verbonden litholichamen in 3D. Elke massa die over je profielen verbonden is, wordt één lichaam. Deze stap vinkt af zodra de litho-solids bestaan.',

  // 6 · Geotechnisch model --------------------------------------------------
  'tutorial.geotech-open.title': 'Open de Geotechniek-stap',
  // FLAG alt: karakteriseringsschattingen — samenstelling voor "characterisation estimates"
  'tutorial.geotech-open.body':
    'Het geotechnisch model verdeelt de lithologische eenheden in NAD-pakkingsklassen. Het leest CPT-afgeleide indicatoren zoals qc en relatieve dichtheid, dus dit zijn karakterisatie-schattingen, geen ontwerpwaarden. Je ontwerpgetallen komen later, in je ontwerptool.',
  'tutorial.geotech-subdivide.title': 'Doorloop de pakkingsstroom',
  'tutorial.geotech-subdivide.body':
    'Schakel op een dwarsprofiel naar de Geotech-as en open de Pakkingsstroom. Ze verloopt in vier stappen: verdeel de sonderingen onder zodat elke lithologische eenheid in haar pakkingsklassen splitst, stel de pakkingscorrelaties voor en aanvaard ze, en verdeel dan de boringen om de klassen mee over te dragen. Deze stap vinkt af zodra het geotechnisch model bestaat.',
  'tutorial.geotech-bodies.title': 'Herberekenen en groeperen',
  'tutorial.geotech-bodies.body':
    "Herbereken de lichamen om vast te leggen welke massa's als één geotechnisch lichaam tellen. Gebruik Voeg samen met om gelijkaardige massa's te groeperen, zodat je meer data en minder exportklassen draagt. Gebruik Ontkoppelen om een lichaam weer uit een groep te lichten. Bouw daarna het geotechnische 3D-model.",

  // 7 · Parameters & statistiek ---------------------------------------------
  'tutorial.params-open.title': 'Open de Parameters-stap',
  'tutorial.params-open.body':
    'In de Parameters-stap rapporteert het afgewerkte model over zichzelf. De eenhedenboom, de statistiek per eenheid en de fence-uitsnede vind je hier allemaal. Alles hier is karakterisatie, nooit een ontwerpberekening.',
  'tutorial.params-jump.title': 'Spring hierheen vanaf een profiel',
  'tutorial.params-jump.body':
    'Je bereikt deze stap ook rechtstreeks vanaf een dwarsprofiel: rechtsklik een lichaamsband en kies “Statistieken van deze eenheid…”. Het opent de Parameters-stap met die eenheid al geselecteerd, zodat je in één stap van een vorm op het profiel naar haar getallen gaat.',
  'tutorial.params-stats.title': 'Statistiek per eenheid',
  'tutorial.params-stats.body':
    'Kies een eenheid om haar statistiek te zien, samengevoegd over elk lichaam dat erbij hoort. De fence-uitsnede toont dezelfde eenheid in de ondergrond, zodat je het getal aan de vorm toetst. Dit is karakterisatie-statistiek, geen ontwerpparameters.',

  // 8 · Exporteren ----------------------------------------------------------
  'tutorial.export-open.title': 'Open de Export-stap',
  'tutorial.export-open.body':
    'Stuur het afgewerkte model met drie niveaus naar je ontwerptools. StrixGeo levert het grondmodel, en de ontwerpcontroles gebeuren in de tool waarnaar je exporteert. Kies het formaat dat je volgende tool nodig heeft.',
  'tutorial.export-dxf.title': 'Een dwarsprofiel exporteren',
  'tutorial.export-dxf.body':
    'Kies een dwarsprofiel en exporteer het naar DXF voor CAD of naar een uitvoerbaar Plaxis 2D-script. Elke export draagt je eenheidsidentificaties mee, zodat het model gelabeld aankomt in de ontwerptool.',
  'tutorial.export-plaxis3d.title': 'Het 3D-model exporteren',
  'tutorial.export-plaxis3d.body':
    'Exporteer het volledige stratigrafische model als een uitvoerbaar Plaxis 3D-script. Het is modelbreed in plaats van profielgebonden, dus het heeft een gebouwd stratigrafisch model nodig, geen enkel profiel.',
  'tutorial.closing.title': 'Je bent klaar',
  'tutorial.closing.body':
    'Dat is de volledige workflow: importeren, dwarsprofiel, stratigrafie, litho, geotech, parameters, export. Bouw je eerste model op je eigen data. Er komen meer import- en exportfuncties, dus stuur de bestandsformaten die je gebruikt naar StrixGeo en wij bouwen ze als volgende.',

  // Extra knoppen + eigenaarsbeslissingen (2026-09-05) -----------------------
  'tutorial.import-search.title': 'Zoek in de lijst',
  'tutorial.import-search.body':
    'Typ in het zoekveld om het huidige tabblad op naam te filteren. Het filtert terwijl je typt; wis het om weer alle onderzoeken te zien.',
  'tutorial.import-sort.title': 'Sorteer de lijst',
  'tutorial.import-sort.body':
    'Sorteer de onderzoeken op naam, diepte of datum en keer de richting om. Sorteren is een weergavehulp; het verandert de data nooit.',
  'tutorial.import-remove-cptm.title': 'Verwijder de mechanische conussen',
  'tutorial.import-remove-cptm.body':
    'Mechanische conussen (CPTM) dragen geen kleef of waterspanning, dus laat ze weg. Vink CPTM uit in de proeftypefilter op de kaart; de grijze rijen staan dan onderaan de sonderingslijst. Klik de eerste, Shift-klik de laatste en druk op Delete om ze uit het project te verwijderen.',
  'tutorial.data-open-cpt.title': 'Open een sondering',
  'tutorial.data-open-cpt.body':
    'Klik een sonderingsrij om haar grafiek te openen. Lees qc, fs, Rf en u2 tegen de diepteas; waar DOV een laagmodel levert, staat het naast de curven. Deze stap vinkt af zodra een sonderingsgrafiek open is.',
  'tutorial.data-open-borehole.title': 'Open een boring',
  'tutorial.data-open-borehole.body':
    'Klik een boringsrij om haar log te openen. Ze toont de beschreven lagen en de classificatieproeven die bij de boring zijn gelogd, inclusief de labresultaten. Deze stap vinkt af zodra een boringslog open is.',
  'tutorial.geo-add-formation.title': 'Voeg een formatie toe',
  'tutorial.geo-add-formation.body':
    'Het paneel toont de formaties in het model, jongste bovenaan. Voeg er met de hand een toe als een eenheid ontbreekt, sleep om ze te herordenen, en gebruik de vertrouwensvervaging om geextrapoleerde ondergrond weg van de data te dimmen.',
  'tutorial.geo-boreholes-in-model.title': 'Boringen in het model',
  'tutorial.geo-boreholes-in-model.body':
    'Deze lijst bepaalt welke boringen het model verankeren. Vink er een uit om ze uit de vlakken te laten terwijl ze op het profiel blijft tekenen; vink opnieuw aan om ze weer op te nemen. Beide zijn omkeerbaar.',
  'tutorial.geo-dedupe.title': 'Contacten ontdubbelen',
  'tutorial.geo-dedupe.body':
    'Ontdubbelen verwijdert dubbele formatiecontacten die na herhaald vullen op elkaar stapelen. Het wist rijen, dus het bevestigt eerst en noemt hoeveel het vond.',
  'tutorial.geo-reset-delete.title': 'Weergave resetten en verwijderen',
  'tutorial.geo-reset-delete.body':
    'Weergave resetten vliegt de 3D-camera terug naar het model en klapt een gesplitst venster dicht. Stratigrafie verwijderen haalt het hele model weg, elke formatie, elk contact en elk vlak, dus het bevestigt altijd eerst.',
  'tutorial.geo-carry-strat.title': 'Draag de stratigrafie over naar de sonderingen',
  'tutorial.geo-carry-strat.body':
    'Houd Shift ingedrukt en sleep een boringscontact zijwaarts over de naburige sonderingskolommen. Het schildert een kopie van dat contact op elke kolom die je passeert, zodat de sonderingen dezelfde onderverdeling dragen. Doe dit voor je de vlakken bouwt.',
  'tutorial.litho-suggest.title': 'Litholagen voorstellen',
  'tutorial.litho-suggest.body':
    'Voorstellen leest de gefocuste kolom met een Robertson-classificatie en stelt litholagen voor als spookgrenzen. De caret biedt de bulkvarianten: voorstellen voor het hele profiel, of enkel voor nieuwe proeven.',
  'tutorial.litho-bodies.title': 'Weergaveopties voor lichamen',
  'tutorial.litho-bodies.body':
    'Het menu Lichamen verzamelt de weergaveschakelaars: vul de banden, toon of verberg de correlatielinten en de gebouwde-modelvulling, reset je handgetekende grenspunten, en schakel de staalmarkers.',
  'tutorial.litho-admixtures.title': 'Bijmengingen',
  'tutorial.litho-admixtures.body':
    'Het menu Bijmengingen ruimt de spookvoorstellen op voor je ze aanvaardt: strip de bijmengingen van de sondering of de boring, strip ze allemaal, of hervul ze vanuit de observatielog van de boring.',
  'tutorial.litho-fence.title': 'Exporteer de litho-fence',
  'tutorial.litho-fence.body':
    'Zodra de solids gebouwd zijn, schrijft Fence exporteren het 3D-fencediagram naar DXF. Het staat naast Model bouwen op deze stap en weigert met een waarschuwing tenzij de weergave in Fence-modus staat.',
  'tutorial.litho-pane.title': 'Het lithologiepaneel',
  'tutorial.litho-pane.body':
    'Het paneel draagt de modelkiezer, de vertrouwensvervaging, de eenhedenlijst met haar lichamenlegende, Instanties oplossen om de lijst te verversen, en de boringen-in-model-selectie. Model wissen wist de lithocontacten na een bevestiging.',
  'tutorial.geotech-statistic.title': 'Kies de representatieve qc',
  'tutorial.geotech-statistic.body':
    'Voor je onderverdeelt, kies je de qc-statistiek waarmee elke pakkingsklasse wordt geclassificeerd. Het is een keuze per model en deel van de modelprovenance, dus het label toont de huidige waarde op de werkbalk.',
  'tutorial.geotech-correlate.title': 'Pakking met de hand correleren',
  'tutorial.geotech-correlate.body':
    'Pakking correleren verbindt een pakkingsband met dezelfde klasse op een buur, de geotech-tegenhanger van litho Correleren. Klik twee banden van dezelfde klasse om ze te koppelen; rechtsklik een koppeling om ze te ontkoppelen.',
  'tutorial.geotech-display.title': 'Weergaveopties geotech',
  'tutorial.geotech-display.body':
    'Het menu Weergave schakelt wat de geotech-as tekent: de pakkingsvulling, de gebouwde-modelvulling, de lithovulling eronder, de boringsvoorbeeldweergave en de correlatielinten.',
  'tutorial.geotech-build.title': 'Bouw het geotechnisch model',
  'tutorial.geotech-build.body':
    'Op de Geotech-stap zet Model bouwen de aanvaarde pakkingsbanden om in 3D NAD-lichamen. Een preflight vraagt naar elke proef die litho draagt maar geen banden, voor het bouwt.',
  'tutorial.geotech-fence.title': 'Exporteer de geotech-fence',
  'tutorial.geotech-fence.body':
    'Zodra de geotech-solids bestaan, schrijft Fence exporteren het 3D-fencediagram naar DXF, net als de litho-stap. Het weigert met een waarschuwing tenzij de weergave in Fence-modus staat.',
  'tutorial.geotech-pane.title': 'Het eenhedenpaneel',
  'tutorial.geotech-pane.body':
    'Het paneel toont de eenheden als grondsoort, dan NAD-pakkingsklasse, dan lichaam, en laat je een rij herkleuren. Klik een lichaam om het op het profiel te selecteren; de uitlezing noemt de klasse en hoe haar qc is toegekend.',
  'tutorial.params-units.title': 'De eenhedenboom',
  'tutorial.params-units.body':
    'De eenhedenboom toont elke eenheid in het afgewerkte model. Vink een eenheid aan om haar statistiek te zien; de tellingen tonen hoeveel lichamen elke eenheid samenbrengt.',
  'tutorial.params-group.title': 'Eenheden groeperen',
  'tutorial.params-group.body':
    'Vink eenheden van dezelfde NAD-klasse over lichamen heen aan en Voeg ze samen tot een rapportgroep; Ontkoppelen licht er een weer uit en Wissen laat de selectie los. Een groep bundelt de statistiek van haar leden onder een hoofding.',
  'tutorial.params-water-table.title': 'De grondwatertafel',
  'tutorial.params-water-table.body':
    'De grondwatertafellijn zegt onder welk niveau elke genormaliseerde waarde erboven berekend is. Klik ze om je eigen diepte in te stellen; het bronlabel toont of ze van jou of van een standaard komt. Alles hier is karakterisatie, nooit een ontwerpwaarde.',
}
