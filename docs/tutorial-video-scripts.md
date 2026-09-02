# Tutorial video scripts

**Date:** 2026-09-02 · **Owner ruling A9** in
`docs/superpowers/specs/2026-09-02-guided-tutorial-design.md`.

## Purpose

This file gives the owner one recording script per tutorial chapter. Each script
is a shot list on the **worked-example project** (a small real Belgian project the
owner builds: DOV CPTs and boreholes, a few cross-sections, and a geological, a
litho, and a geotech model). Every shot names a real control, the action to
perform on camera, and the narration in Dutch and English.

The narration is derived from the tutorial's own copy in
`desktop/src/renderer/src/i18n/locales/{en,nl}/tutorial.ts`. It reuses that
vocabulary. It does not introduce new product terms. **Dutch is the primary take**
(the BE/NL market). The English take is a faithful translation of the same script,
not a different one.

Keep faith with what the product is. StrixGeo delivers a **ground model plus
characterisation** (geological, litho, and geotech units, with CPT-derived
estimates). It does **not** perform design calculations. Bearing capacity,
settlement, slope stability, and pile or wall design happen downstream in Plaxis,
D-Stability, D-Sheet, or GeoStudio. Never let the narration promise a design
number.

## Where the videos live

Each chapter has one video. The videos are hosted on a **strixgeo.com** page per
chapter, with the YouTube channel embedded there. The app's coach card shows a
"Watch the clip" button ("Bekijk het filmpje") that opens the **strixgeo.com**
page through `videoUrl`. It never links to YouTube directly, so the channel can
move without breaking the app. No URLs exist yet.

## Recording conventions

- Record at 1080p.
- Record the English take with the app language set to English. Record the Dutch
  take with the app language set to Dutch.
- Turn the cursor highlight on.
- Use no background music under the narration.
- Target 2 to 5 minutes per chapter. One chapter is one video.
- Record on the worked-example project only. Do not show another project.
- Record the Dutch take first. Then re-run the same shot list for English.

## How to read a shot

Each shot gives three things. **On screen** names the control and its anchor
(the `data-testid` the tutorial spotlight targets). **Action** is what the owner
does on camera. **EN** and **NL** are the narration for the two takes.

- A `<!-- CHECK: ... -->` line marks a spot where the exact on-screen wording was
  not verified against the rendered UI. Confirm it before recording.
- A `<!-- DRAFT: owner to confirm -->` line marks narration written from the
  design spec because the catalogue copy for that step is a one-sentence
  skeleton (chapters 4 to 8).
- All quoted control labels come from the tutorial i18n draft. Confirm each label
  reads the same on screen when you record.

---

## Chapter 1 — Your project / Je project

**Target length:** 2 to 3 minutes.

**Goal:** the viewer can create a project and set its coordinate system and
vertical datum correctly.

**Shot 1 — Name your project.**
On screen: the new-project dialog, name field (`welcome-project-name-input`).
<!-- CHECK: exact dialog title and name-field label -->
Action: type the worked-example name, for example `GEO-22/040 Brugge`.
EN: "Every project starts with a name. Use something you will recognise later.
Your job number and the site work well, like GEO-22/040 Brugge. You add the
client and the phase afterwards."
NL: "Elk project begint met een naam. Kies iets dat je later herkent. Je
dossiernummer en de locatie werken goed, zoals GEO-22/040 Brugge. Klant en fase
voeg je nadien toe."

**Shot 2 — Create the project.**
On screen: the Create-project button (`welcome-new-project-button`).
<!-- CHECK: exact button label ("Create project") -->
Action: click Create project. The empty project opens.
EN: "Click Create project to open it. From here on every CPT, borehole, section,
and model lives inside this project. It is all saved with the project."
NL: "Klik op Project aanmaken om het te openen. Vanaf hier leeft elke sondering,
boring, dwarsprofiel en model in dit project. Alles wordt mee opgeslagen."

**Shot 3 — Set the coordinate system.**
On screen: the horizontal-CRS field in the project metadata
(`project-crs-horizontal`).
<!-- CHECK: exact field label and where project metadata opens -->
Action: open the project metadata. Choose Lambert 72 (EPSG 31370) for the Brugge
site.
EN: "Open the project metadata and choose the horizontal coordinate system. Use
Lambert 72, EPSG 31370, for Belgium. Use RD New, EPSG 28992, for the Netherlands.
It must match how your data was surveyed, or every location lands in the wrong
place."
NL: "Open de projectgegevens en kies het horizontale coordinatensysteem. Gebruik
Lambert 72, EPSG 31370, voor Belgie. Gebruik RD New, EPSG 28992, voor Nederland.
Het moet overeenkomen met hoe je data is ingemeten, anders belandt elke locatie
op de verkeerde plek."

**Shot 4 — Set the vertical datum.**
On screen: the vertical-datum field (`project-crs-vertical`).
<!-- CHECK: exact field label -->
Action: choose TAW for the Belgian site.
EN: "The vertical datum is the zero that every elevation is measured from. Use
TAW in Belgium. Use NAP in the Netherlands. Pick the one your levels use, so
depths and surface heights read correctly across the whole model."
NL: "Het hoogtereferentievlak is het nulpunt waartegen elke hoogte wordt gemeten.
Gebruik TAW in Belgie. Gebruik NAP in Nederland. Kies het vlak dat je peilen
gebruiken, zodat dieptes en maaiveldhoogtes overal correct worden weergegeven."

**Closing:** "The project is set. Next, we bring in the data."
NL: "Het project staat klaar. Hierna halen we de data binnen."

---

## Chapter 2 — Import data / Data importeren

**Target length:** 4 to 5 minutes.

**Goal:** the viewer can import CPTs and boreholes from DOV, filter the list, hide
a test, and import a local GEF file.

**Shot 1 — The Import menu.**
On screen: the Import menu button (`import-menu-button`).
<!-- CHECK: exact menu-button label -->
Action: open the Import menu and let the list of importers show.
EN: "This is where data comes in. Open it to see every importer StrixGeo offers
today. You import CPTs and boreholes, from local files or straight from DOV."
NL: "Hier komt data binnen. Open het om te zien welke importmogelijkheden
StrixGeo vandaag biedt. Je importeert sonderingen en boringen, uit lokale
bestanden of rechtstreeks uit DOV."

**Shot 2 — Import CPTs from DOV.**
On screen: the "Import CPT from DOV" verb (`import-verb-cpt-dov`).
<!-- CHECK: exact verb label; NL "Sondering (CPT) importeren uit DOV" -->
Action: choose the verb. Drag a box on the map over the worked-example site. Let
the soundings stream in.
EN: "Choose Import CPT from DOV, then drag a box on the map. Every sounding DOV
holds inside that box streams in, with its depth series and its location."
NL: "Kies Sondering importeren uit DOV en teken een kader op de kaart. Elke
sondering die DOV binnen dat kader heeft, stroomt binnen, met haar diepteserie en
haar locatie."

**Shot 3 — Filter by date.**
On screen: the date filter (`data-filter-date`).
<!-- CHECK: exact date-filter label -->
Action: set a date range that narrows the list. Then clear it.
EN: "Long lists get unwieldy. Set a date range to show only the investigations
from the period you work on. Clear it to see them all again."
NL: "Lange lijsten worden onhandig. Stel een datumbereik in om enkel de
onderzoeken uit de betreffende periode te tonen. Wis het om ze weer allemaal te
zien."

**Shot 4 — Filter by test type.**
On screen: the test-type filter (`data-filter-testtype-cpt`).
<!-- CHECK: exact test-type tab labels (CPT / borehole) -->
Action: switch between the CPT tab and the borehole tab.
EN: "Switch between CPTs and boreholes here. Each tab shows only that kind of
investigation, so you work through one type at a time."
NL: "Schakel hier tussen sonderingen en boringen. Elk tabblad toont enkel dat
type onderzoek, zodat je een type per keer afwerkt."

**Shot 5 — Hide a test.**
On screen: the row remove control (`data-row-remove`).
<!-- CHECK: exact remove/hide affordance label -->
Action: remove one sounding that does not belong in the dataset. Show that it is
hidden, not deleted.
EN: "Not every sounding belongs in your dataset. Remove one to hide it from this
project. The hide is reversible and project-local. You restore it any time. The
data itself is never deleted."
NL: "Niet elke sondering hoort in je dataset. Verwijder er een om ze uit dit
project te verbergen. De verberging is omkeerbaar en projectlokaal. Je herstelt
ze altijd. De data zelf wordt nooit gewist."

**Shot 6 — Import boreholes from DOV.**
On screen: the "Import Borehole from DOV" verb (`import-verb-borehole-dov`).
<!-- CHECK: exact verb label; NL "Boring importeren uit DOV" -->
Action: choose the verb. Draw a box on the map over the same site. Let the
boreholes land.
EN: "Boreholes come in the same way. Choose Import Borehole from DOV and draw a
box on the map."
NL: "Boringen komen op dezelfde manier binnen. Kies Boring importeren uit DOV en
teken een kader op de kaart."

**Shot 7 — Import local GEF files.**
On screen: the "Import CPT (.gef)" verb (`import-verb-cpt-gef`).
<!-- CHECK: exact verb label; NL "Sondering (CPT) importeren (.gef)" -->
Action: choose the verb. Pick a GEF file from disk for a sounding that is not in
DOV.
EN: "Have CPTs on disk? Import CPT, dot gef, reads standard GEF files straight
from your computer. It is useful for soundings that are not in DOV."
NL: "Sonderingen op schijf? Sondering importeren, punt gef, leest standaard
GEF-bestanden rechtstreeks van je computer. Handig voor sonderingen die niet in
DOV zitten."

**Shot 8 — More sources are coming.**
On screen: the roadmap verb, for example DMT (`import-verb-dmt`).
<!-- CHECK: which verbs show the "Phase 4" marker on screen today -->
Action: point at the greyed roadmap entries.
EN: "DMT, lab tests, and monitoring data are on the roadmap. For now you see them
marked Phase 4 in the menu."
NL: "DMT, labproeven en monitoringdata staan op de planning. Voorlopig zie je ze
in het menu met de vermelding Phase 4."
<!-- CHECK: A5 — the owner's brief named one more importer ("Safety, q three part m", unresolved, not G3Dv3). Add a shot here when he names it. -->

**Shot 9 — Need another format?**
On screen: the Import menu again (`import-menu-button`).
Action: close on the full menu.
EN: "More importers are coming, depending on what you need. Send the file formats
you use to StrixGeo, and we build the parser."
NL: "Er komen meer importfuncties, afhankelijk van wat je nodig hebt. Stuur de
bestandsformaten die je gebruikt naar StrixGeo, en wij bouwen de parser."

**Closing:** "The data is in. Next, we cut a cross-section through it."
NL: "De data zit erin. Hierna snijden we er een dwarsprofiel doorheen."

---

## Chapter 3 — Cross-sections / Dwarsprofielen

**Target length:** 4 to 5 minutes.

**Goal:** the viewer can create a cross-section and knows what every control on
the section header and inspector does.

**Shot 1 — Create a cross-section.**
On screen: the create-section control (`section-create`).
<!-- CHECK: exact create-section label -->
Action: create a section. Draw the line through the soundings you want to
correlate.
EN: "A cross-section is where you build and edit all three models. Create your
first one. Draw the line through the investigations you want to correlate."
NL: "Een dwarsprofiel is waar je alle drie de modellen bouwt en bewerkt. Maak je
eerste aan. Teken de lijn door de onderzoeken die je wilt correleren."

**Shot 2 — Projection buffer.**
On screen: the projection-buffer control (`section-control-buffer`).
<!-- CHECK: exact control label -->
Action: widen the buffer, then narrow it. Show tests appear and drop off.
EN: "The buffer is how far to either side of the line a test can sit and still be
projected onto the section. Widen it to catch more soundings. Narrow it to keep
only the ones on the line."
NL: "De buffer is hoe ver een proef aan weerszijden van de lijn mag liggen om er
nog op geprojecteerd te worden. Verbreed hem om meer sonderingen mee te nemen.
Versmal hem om enkel die op de lijn te houden."

**Shot 3 — Column spacing.**
On screen: the column-spacing control (`section-control-spacing`).
<!-- CHECK: exact control label -->
Action: raise the spacing so overlapping columns separate.
EN: "Spacing spreads the projected columns apart, so overlapping tests stop
hiding each other. At zero percent each test sits at its true position along the
section. Higher values trade that for legibility."
NL: "De kolomafstand spreidt de geprojecteerde kolommen uit, zodat overlappende
proeven elkaar niet langer verbergen. Bij nul procent staat elke proef op haar
echte positie langs het profiel. Hogere waarden ruilen dat in voor leesbaarheid."

**Shot 4 — Vertical exaggeration.**
On screen: the vertical-exaggeration control (`section-control-vexag`).
<!-- CHECK: exact control label -->
Action: increase the exaggeration so thin layers become readable.
EN: "Ground is far wider than it is deep, so thin layers vanish at true scale.
Vertical exaggeration stretches the depth axis to make them readable. Only the
drawing is stretched. The numbers stay real."
NL: "De ondergrond is veel breder dan diep, dus dunne lagen verdwijnen op ware
schaal. Verticale overhoging rekt de diepteas uit om ze leesbaar te maken. Enkel
de tekening wordt uitgerekt. De getallen blijven echt."

**Shot 5 — CPT data channels.**
On screen: the channel toggles, qc first (`section-control-channel-qc`).
<!-- CHECK: exact channel-toggle labels (qc / Rf / fs / u2 / qT) -->
Action: toggle qc, Rf, fs, u2, and qT. Leave only the ones you read.
EN: "Toggle the CPT traces, qc, Rf, fs, u2, and qT, to show only the ones you are
reading. Fewer channels means a cleaner column when you correlate layers."
NL: "Schakel de CPT-curven, qc, Rf, fs, u2 en qT, om enkel te tonen wat je
afleest. Minder kanalen geeft een overzichtelijkere kolom bij het correleren van
lagen."

**Shot 6 — Borehole streams.**
On screen: the borehole-stream toggle (`section-control-borehole-geo`).
<!-- CHECK: exact stream-toggle labels -->
Action: turn a borehole stream on and off. Show the strip appear next to the CPTs.
EN: "Boreholes can show more than one interpretation stream side by side. Turn
each one on or off. Every enabled stream draws as its own strip next to the CPTs."
NL: "Boringen kunnen meerdere interpretatiestromen naast elkaar tonen. Zet elke
stroom aan of uit. Elke actieve stroom tekent als een eigen strook naast de
sonderingen."

**Shot 7 — Model axis.**
On screen: the axis tabs, Geology first (`axis-geology`).
<!-- CHECK: exact axis-tab labels (Geology / Litho / Geotech) -->
Action: switch the axis between Geology, Litho, and Geotech.
EN: "The same section edits all three levels. Switch the axis between Geology,
Litho, and Geotech to work on each model in turn, without leaving the section."
NL: "Hetzelfde profiel bewerkt alle drie de niveaus. Wissel de as tussen
Geologie, Litho en Geotech om elk model op zijn beurt te bewerken, zonder het
profiel te verlaten."

**Shot 8 — Snap to stratigraphy.**
On screen: the snap control (`section-control-snap`).
<!-- CHECK: exact snap label -->
Action: turn Snap on. Click near a logged boundary and show it lands on it.
EN: "With Snap on, a click near a logged boundary lands exactly on it, not a
pixel off. It keeps your contacts tied to the stratigraphy the boreholes record."
NL: "Met de Snap-knop aan belandt een klik vlak bij een gelogde grens er exact
op, niet een pixel ernaast. Zo blijven je grenzen verbonden met de stratigrafie
die de boringen registreren."

**Shot 9 — The ground surface.**
On screen: the DEM line across the top (`section-dem-line`).
<!-- CHECK: how the DEM line is labelled or called out on screen -->
Action: point at the grey terrain line.
EN: "The grey line across the top is the terrain from the DEM. It is drawn
automatically wherever the ground level is known. It is the reference your
elevations hang from."
NL: "De grijze lijn bovenaan is het maaiveld uit het DEM. Het wordt automatisch
getekend overal waar de maaiveldhoogte bekend is. Het is de referentie waaraan je
hoogtes hangen."

**Shot 10 — Your view is saved.**
On screen: the view Reset control (`section-view-reset`).
<!-- CHECK: exact Reset label -->
Action: reopen the section to show the framing returned. Then click Reset.
EN: "Every setting here, buffer, spacing, exaggeration, channels, and snap, saves
to this section on its own. Reopen it and the framing is exactly as you left it.
Reset returns the default view."
NL: "Elke instelling hier, buffer, afstand, overhoging, kanalen en snap, wordt
vanzelf bij dit dwarsprofiel bewaard. Heropen het en de kadrering staat exact
zoals je ze achterliet. Reset zet de standaardweergave terug."

**Closing:** "The section is our editing surface. Next, we lay the geological
backbone on it."
NL: "Het profiel is onze bewerkingslaag. Hierna leggen we er de geologische
ruggengraat op."

---

## Chapter 4 — Geological model / Geologisch model

**Target length:** 3 to 4 minutes.

**Goal:** the viewer can seed a geological model from boreholes, lump two units
into one formation, and rebuild the surfaces.

**Shot 1 — Open the Geology stage.**
On screen: the Geology stage tab (`stage-tab-geology`).
<!-- CHECK: exact stage-tab label -->
Action: open the Geology stage.
EN: "The geological model is the backbone. It holds the formations and the
surfaces between them, the regional layers under your whole site."
NL: "Het geologisch model is de ruggengraat. Het bevat de formaties en de vlakken
ertussen, de regionale lagen onder je hele terrein."
<!-- DRAFT: owner to confirm -->

**Shot 2 — Seed from boreholes.**
On screen: the seed control in the section inspector (`inspector-seed`).
<!-- CHECK: exact seed-control label -->
Action: seed the model. Show the first formation contacts appear on the borehole
columns.
EN: "Seed the model's first contacts from your boreholes. StrixGeo reads the
formation tops the boreholes log and places a contact at each one."
NL: "Zaai de eerste contacten van het model vanuit je boringen. StrixGeo leest de
formatietoppen die de boringen loggen en plaatst een contact op elke top."
<!-- DRAFT: owner to confirm -->

**Shot 3 — Same unit, different name.**
On screen: the Geology stage, stratigraphy list (`stage-tab-geology`).
<!-- CHECK: exact control for lumping stratigraphy into one formation -->
Action: lump two units that are the same formation into one.
EN: "Sometimes two logged units are the same formation under different names. Lump
the stratigraphy to tell the model they are one formation. From here the extracted
contacts also reach the CPT columns, so the section reads as one story."
NL: "Soms zijn twee gelogde eenheden dezelfde formatie onder een andere naam.
Voeg de stratigrafie samen om het model te vertellen dat ze een formatie zijn.
Van hieruit bereiken de afgeleide contacten ook de sonderingskolommen, zodat het
profiel als een geheel leest."
<!-- DRAFT: owner to confirm -->

**Shot 4 — Build the surfaces.**
On screen: the build control in the section inspector (`inspector-build`).
<!-- CHECK: exact build-control label -->
Action: rebuild the surfaces. Point out the crossing check.
EN: "Rebuild the formation surfaces from the contacts. Then check where any two
surfaces cross, because a valid model keeps its formations in order."
NL: "Herbouw de formatievlakken vanuit de contacten. Controleer daarna waar twee
vlakken elkaar kruisen, want een geldig model houdt zijn formaties op volgorde."
<!-- DRAFT: owner to confirm -->

**Closing:** "The backbone is in place. Next, we refine it into lithological
units."
NL: "De ruggengraat staat. Hierna verfijnen we ze tot lithologische eenheden."

---

## Chapter 5 — Lithostratigraphic model / Lithostratigrafisch model

**Target length:** 3 to 4 minutes.

**Goal:** the viewer can accept segmenter suggestions, correlate columns, and
build the litho bodies.

**Shot 1 — Open the Lithology stage.**
On screen: the Lithology stage tab (`stage-tab-lithology`).
<!-- CHECK: exact stage-tab label -->
Action: open the Lithology stage.
EN: "The litho model refines the geological backbone into lithological units along
your sections. Think sand, clay, silt, gravel, and peat, with their admixtures."
NL: "Het lithomodel verfijnt de geologische ruggengraat tot lithologische
eenheden langs je profielen. Denk aan zand, klei, silt, grind en veen, met hun
bijmengingen."
<!-- DRAFT: owner to confirm -->

**Shot 2 — Accept the suggestions.**
On screen: the Lithology stage, segmenter suggestions on a column
(`stage-tab-lithology`).
<!-- CHECK: exact Accept control for a segmenter suggestion -->
Action: accept the suggested litho layers that match what you read on the trace.
EN: "The segmenter proposes litho layers on each column. It reads the CPT with a
Robertson classification. Accept the ones that match what you see. This is
assisted work, not automatic correlation. You stay in control of every layer."
NL: "De segmenter stelt lithologische lagen voor op elke kolom. Hij leest de
sondering met een Robertson-classificatie. Aanvaard die welke overeenkomen met
wat je ziet. Dit is ondersteund werk, geen automatische correlatie. Jij houdt
elke laag in de hand."
<!-- DRAFT: owner to confirm -->

**Shot 3 — Build the litho bodies.**
On screen: the build control in the section inspector (`inspector-build`).
<!-- CHECK: exact build-control label -->
Action: build. Show the connected litho bodies appear.
EN: "Build turns the accepted layers into connected litho bodies in three
dimensions. Each mass that connects across your sections becomes one body."
NL: "Bouwen zet de aanvaarde lagen om in verbonden lithobodies in drie dimensies.
Elke massa die over je profielen verbonden is, wordt een body."
<!-- DRAFT: owner to confirm -->

**Closing:** "The litho units are built. Next, we subdivide them by packing."
NL: "De lithologische eenheden staan. Hierna verdelen we ze op pakking."

---

## Chapter 6 — Geotechnical model / Geotechnisch model

**Target length:** 3 to 4 minutes.

**Goal:** the viewer can subdivide litho units into NAD packing classes, and
recompute, join, or separate the geotech bodies.

**Shot 1 — Open the Geotechnics stage.**
On screen: the Geotechnics stage tab (`stage-tab-geotechnical`).
<!-- CHECK: exact stage-tab label -->
Action: open the Geotechnics stage.
EN: "The geotech model subdivides the litho units into NAD packing classes, from
CPT-derived indicators. These are characterisation estimates, not design values.
Your design numbers come later, in your design tool."
NL: "Het geotechnisch model verdeelt de lithologische eenheden in
NAD-pakkingsklassen, op basis van CPT-afgeleide indicatoren. Dit zijn
karakterisatie-schattingen, geen ontwerpwaarden. Je ontwerpgetallen komen later,
in je ontwerptool."
<!-- DRAFT: owner to confirm -->

**Shot 2 — Run the packing pipeline.**
On screen: the Geotechnics stage, subdivide control (`stage-tab-geotechnical`).
<!-- CHECK: exact subdivide / divide-boreholes control label -->
Action: subdivide the CPTs. Show each unit split into its packing classes.
EN: "Subdivide the CPTs to build the geotech model. Each litho unit splits into
its packing classes, driven by the CPT qc and relative density."
NL: "Verdeel de sonderingen om het geotechnisch model te bouwen. Elke
lithologische eenheid splitst in haar pakkingsklassen, gestuurd door de qc en de
relatieve dichtheid van de sondering."
<!-- DRAFT: owner to confirm -->

**Shot 3 — Correlate and recompute.**
On screen: the recompute-bodies control in the section (`sections-recompute-bodies`).
<!-- CHECK: exact recompute-bodies label; Join / Separate verb labels -->
Action: recompute the bodies. Use Join or Separate on two masses.
EN: "Recompute the bodies. Then use Join with, or Separate, where two masses are,
or are not, the same body. Join groups similar masses so you carry more data and
fewer export classes. Separate keeps two touching masses apart for good."
NL: "Herbereken de bodies. Gebruik daarna Voeg samen met, of Scheiden, waar twee
massa's wel of niet dezelfde body zijn. Voeg samen groepeert gelijkaardige massa's
zodat je meer data en minder exportklassen draagt. Scheiden houdt twee rakende
massa's definitief uit elkaar."
<!-- DRAFT: owner to confirm -->
<!-- CHECK: the spec names the separation verb "Ontkoppelen"; the shipped NL catalogue and owner rulings use "Scheiden van..." and "Voeg samen met...". Script uses the shipped terms. -->

**Closing:** "The three models are built. Next, we read their statistics."
NL: "De drie modellen staan. Hierna lezen we hun statistiek af."

---

## Chapter 7 — Parameters & statistics / Parameters & statistiek

**Target length:** 2 to 3 minutes.

**Goal:** the viewer can read per-unit statistics from the unit tree and see the
fence cutout.

**Shot 1 — Open the Parameters stage.**
On screen: the Parameters stage tab (`stage-tab-parameters`).
<!-- CHECK: exact stage-tab label -->
Action: open the Parameters stage.
EN: "The unit tree, the per-unit statistics, and the fence cutout live here. This
is where the finished model reports on itself."
NL: "De eenhedenboom, de statistiek per eenheid en de fence-uitsnede vind je hier.
Hier rapporteert het afgewerkte model over zichzelf."
<!-- DRAFT: owner to confirm -->

**Shot 2 — Per-unit statistics.**
On screen: the Parameters stage, unit tree (`stage-tab-parameters`).
<!-- CHECK: exact unit-tree control and statistics panel wording -->
Action: pick a unit. Show its statistics, pooled across every body in the unit.
Point at the fence cutout.
EN: "Pick a unit to see its statistics, pooled across every body that belongs to
it. The fence cutout shows the same unit in the ground, so you check the number
against the shape. These are characterisation statistics, not design parameters."
NL: "Kies een eenheid om haar statistiek te zien, samengevoegd over elke body die
erbij hoort. De fence-uitsnede toont dezelfde eenheid in de ondergrond, zodat je
het getal aan de vorm toetst. Dit is karakterisatie-statistiek, geen
ontwerpparameters."
<!-- DRAFT: owner to confirm -->

**Closing:** "The model reports cleanly. Last, we send it to your design tools."
NL: "Het model rapporteert netjes. Tot slot sturen we het naar je ontwerptools."

---

## Chapter 8 — Export / Exporteren

**Target length:** 2 to 3 minutes.

**Goal:** the viewer can export a section to the design tools and knows where to
ask for more.

**Shot 1 — Open the Export stage.**
On screen: the Export stage tab (`stage-tab-export`).
<!-- CHECK: exact stage-tab label -->
Action: open the Export stage.
EN: "Send the finished three-level model to your design tools. StrixGeo hands over
the ground model. The design checks happen in the tool you export to."
NL: "Stuur het afgewerkte model met drie niveaus naar je ontwerptools. StrixGeo
levert het grondmodel. De ontwerpcontroles gebeuren in de tool waarnaar je
exporteert."
<!-- DRAFT: owner to confirm -->

**Shot 2 — Export your model.**
On screen: the section DXF export control (`export-section-dxf`).
<!-- CHECK: exact export-control labels (DXF / Plaxis / D-Stability / D-Sheet / PDF sheet) -->
Action: export a section. Show DXF, Plaxis, D-Stability or D-Sheet, and the PDF
report sheet.
EN: "Export a section to DXF, to Plaxis, to D-Stability or D-Sheet, or to a PDF
report sheet. Each export carries your unit identifiers, so the model arrives
labelled in the design tool."
NL: "Exporteer een dwarsprofiel naar DXF, naar Plaxis, naar D-Stability of
D-Sheet, of naar een PDF-rapportblad. Elke export draagt je eenheidsidentificaties
mee, zodat het model gelabeld aankomt in de ontwerptool."
<!-- DRAFT: owner to confirm -->

**Shot 3 — You are all set.**
On screen: the Export stage (`stage-tab-export`).
Action: close on the finished model.
EN: "That is the whole workflow. Import, section, geology, litho, geotech,
parameters, and export. Build your first model, and tell us what you need next.
Send us the file formats you use, and we build the parser."
NL: "Dat is de volledige workflow. Importeren, dwarsprofiel, geologie, litho,
geotech, parameters en export. Bouw je eerste model, en laat ons weten wat je
daarna nodig hebt. Stuur ons de bestandsformaten die je gebruikt, en wij bouwen
de parser."
<!-- DRAFT: owner to confirm -->

**Closing:** "That completes the tutorial series. Thank you for building with
StrixGeo."
NL: "Dat rondt de tutorialreeks af. Bedankt om met StrixGeo te bouwen."

---

## Owner checklist before recording

1. Build the worked-example project first. Import its DOV CPTs and boreholes, cut
   its sections, and finish its geological, litho, and geotech models.
2. Open the worked-example project.
3. Set the app language. Use Dutch for the NL take and English for the EN take.
4. Decide what the coach cards do while you record. Clear the tutorial progress
   with Help then Restart tutorial, so the coach cards match the video step by
   step. Or hide the cards entirely. Your call.
   (The Help menu items are "Tutorial" and "Restart tutorial", verified in the main-process menu.)
5. Turn the cursor highlight on. Turn background music off. Record at 1080p.
6. Record the Dutch take first. Then re-run the same shot list for English.
7. Upload each chapter to its strixgeo.com page. Then set the chapter `videoUrl`
   so the coach card's "Watch the clip" button opens it.
