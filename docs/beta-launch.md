# Closed beta launch: playbook, tester mail, LinkedIn post (2026-09-16)

Owner rulings behind this file: no video tutorials for the closed beta; the
release build is the last installer the owner checked himself (#42 or its
successor); everything goes to `main`; backwards compatibility is armed
(`docs/backwards-compat.md`); the site carries the open-beta sign-up; every
tester gets one mail with a download link and the way to report a problem.
Since 2026-10-17 StrixGeo is free and open source (AGPL-3.0-or-later): there is
no key and no licence check, the installer opens the app directly.

## Sequence

1. `develop` green and pushed (integration gate). The installer built from
   that commit has its git SHA verified. The owner runs his last
   check on it.
2. Fast-forward `develop` into `main`; tag `v0.1.0-beta.1`. From here the
   branch model in CLAUDE.md applies (features off `develop`, releases as
   fast-forwards into `main`).
3. Publish the installer to the public releases repo
   (`Vorsie/strixgeo-releases`, `npm run release`, draft first, publish after a
   download check), so the updater feed and the download link exist.
   Unsigned: the mail says so.
4. Site update live: download page, the manual under `/manual/`, the
   open-beta sign-up wired to the MailerLite form.
5. Mail the cohort (template below), one mail per tester. Keep a private
   sheet: tester, date, replies.
6. LinkedIn post (below) the same day, or the day after the first testers
   confirm the installer runs.

## Facts the mail relies on

* Download: `https://github.com/Vorsie/strixgeo-releases/releases/latest`
  (also linked from `https://strixgeo.com/download/`). Windows 10/11 64-bit,
  about 440 MB. First start after install takes one to two minutes (the
  bundled database initialises, the engine loads); every later start is a
  few seconds.
* Unsigned installer: SmartScreen shows "Windows protected your PC"; "More
  info", then "Run anyway".
* No key and no activation: the installer opens the app directly, on any
  number of machines, fully offline. Builds do not expire; Help > Check for
  updates installs the next build.
* Nothing is uploaded. The project file (.strix) stays on the tester's disk.
* Feedback address: info@strixgeo.com. Three things per report: the .strix
  file (File > Save), the zip from Help > Save logs for support, and what the
  tester did, expected and saw, plus a screenshot when it is visual.
* Manual: `https://strixgeo.com/manual/` (EN), the app follows the system
  language (NL/EN).

## Mail to a closed-beta tester (English)

Subject: StrixGeo closed beta: your download link

Hi <first name>,

Thanks for testing StrixGeo. You are one of a small group of engineers who
model ground for a living, and that is exactly the judgment I need before
this goes wider. Below is everything you need.

**What it is.** StrixGeo builds one ground model per project from CPTs,
boreholes and lab data: import (or pull public DOV data straight off the
map), correlate on cross-sections, subdivide into geotechnical units with
CPT-derived packing classes, and export to your design tools with unit
identifiers. Desktop, offline, your data stays on your disk.

**Install.**

1. Download: https://github.com/Vorsie/strixgeo-releases/releases/latest
   (Windows 10/11, 64-bit, about 440 MB).
2. The installer is not code-signed yet. SmartScreen will show "Windows
   protected your PC": click "More info", then "Run anyway".
3. The first start takes one to two minutes (the bundled database
   initialises). Every later start takes a few seconds.

No key and no activation: StrixGeo is free and open source, so the
installer opens the app directly, on as many machines as you like, and it
works fully offline.

**What I ask of you.** Use it on a real project, start to end: import, a
cross-section, the lithological model, the packing classes, and if you get
there a 3D model and an export. The built-in tutorial ("Start the tutorial"
on the start screen) walks the whole flow in about twenty minutes. Nothing
you do is uploaded.

**When something goes wrong, send me three things** at info@strixgeo.com:

1. the project file (File > Save, attach the .strix file),
2. the logs (Help > Save logs for support, attach the zip it writes),
3. two or three sentences: what you did, what you expected, what happened.
   A screenshot helps when the problem is visual.

Questions of any kind go to the same address. You get me, not a ticket
system, usually the same day. The user manual is at
https://strixgeo.com/manual/.

**Timeline.** The feedback round runs until 1 November 2026. Help > Check for updates
installs each new build. Expect a new build about once a week while
your feedback comes in.

**What it is not yet.** This is a minimum viable product. The modelling
workflow is complete. Design parameters (friction angle, undrained shear
strength and the like) are deliberately not there; the exports to Plaxis,
D-Stability and D-Sheet Piling write geometry and unit identifiers only, and
nobody but me has validated them. The map import pulls public data for
Flanders only (DOV); elsewhere you import your own GEF files. Structural
geology (faults, folds, dipping structures) is not implemented; layers are
modelled as they are read in the tests. Your judgment on all of this is what
I am after.

Robin

## Mail to a closed-beta tester (Dutch)

Onderwerp: StrixGeo gesloten beta: je downloadlink

Dag <voornaam>,

Bedankt om StrixGeo te testen. Je hoort bij een kleine groep ingenieurs die
dagelijks grond modelleren, en net dat oordeel heb ik nodig voor dit breder
gaat. Hieronder staat alles wat je nodig hebt.

**Wat het is.** StrixGeo bouwt per project een grondmodel uit sonderingen,
boringen en labodata: importeren (of publieke DOV-data rechtstreeks van de
kaart halen), correleren op dwarsprofielen, onderverdelen in geotechnische
eenheden met pakkingsklassen afgeleid uit de sondering, en exporteren naar
je rekentools met eenheidsidentificaties. Desktop, offline, je data blijft
op je schijf.

**Installeren.**

1. Download: https://github.com/Vorsie/strixgeo-releases/releases/latest
   (Windows 10/11, 64-bit, ongeveer 440 MB).
2. De installer is nog niet gesigneerd. SmartScreen toont "Windows heeft je
   pc beschermd": klik op "Meer informatie" en daarna op "Toch uitvoeren".
3. De eerste start duurt een tot twee minuten (de meegeleverde databank
   wordt aangemaakt). Elke latere start duurt enkele seconden.

Geen sleutel en geen activatie: StrixGeo is gratis en open source, dus de
installer opent de app meteen, op zoveel machines als je wil, en hij werkt
volledig offline.

**Wat ik vraag.** Gebruik het op een echt project, van begin tot eind:
import, een dwarsprofiel, het lithologisch model, de pakkingsklassen, en als
je zover raakt een 3D-model en een export. De ingebouwde tutorial ("Start de
tutorial" op het startscherm) loopt de hele flow in een twintigtal minuten
door. Niets wat je doet wordt geupload.

**Loopt er iets mis, stuur me dan drie dingen** naar info@strixgeo.com (de
menubalk is in deze build nog Engels):

1. het projectbestand (File > Save, voeg het .strix-bestand toe),
2. de logs (Help > Save logs for support, voeg de zip toe die hij schrijft),
3. twee of drie zinnen: wat je deed, wat je verwachtte, wat er gebeurde. Een
   schermafbeelding helpt als het probleem visueel is.

Vragen van elke soort mogen naar hetzelfde adres. Je krijgt mij, geen
ticketsysteem, meestal dezelfde dag. De handleiding staat op
https://strixgeo.com/manual/.

**Timing.** De feedbackronde loopt tot 1 november 2026. *Help > Controleren op
updates* installeert elke nieuwe build. Reken op een nieuwe build
ongeveer elke week zolang jullie feedback binnenkomt.

**Wat het nog niet is.** Dit is een minimum viable product. De modelleerflow
is compleet. Ontwerpparameters (wrijvingshoek, ongedraineerde schuifsterkte
en zo verder) zitten er bewust niet in; de exports naar Plaxis, D-Stability
en D-Sheet Piling schrijven enkel geometrie en eenheidsidentificaties, en
niemand behalve ik heeft ze gevalideerd. De kaartimport haalt enkel publieke
data van Vlaanderen op (DOV); elders importeer je je eigen GEF-bestanden.
Structurele geologie (breuken, plooien, hellende structuren) zit er niet
in; lagen worden gemodelleerd zoals de proeven ze aanlezen. Jouw oordeel over
dit alles is wat ik zoek.

Robin

## LinkedIn post (Dutch, the owner's voice)

> Ik heb de voorbije maanden iets gebouwd waar ik als geotechnisch ingenieur
> zelf al jaren op wacht: een tool die van sonderingen en boringen een
> grondmodel maakt, zonder gINT, zonder Excel-acrobatie, zonder een
> tekenaar ertussen.
>
> Het heet StrixGeo. Je importeert je sonderingen en boringen (of je haalt
> ze in Vlaanderen rechtstreeks van de DOV-kaart), je trekt een dwarsprofiel,
> je correleert je lagen, je verdeelt ze onder in geotechnische eenheden met
> pakkingsklassen uit de sondering, en je exporteert naar Plaxis,
> D-Stability of D-Sheet met je eenheden erbij. Desktop, offline, je data
> blijft bij jou.
>
> Eerlijk: het is een MVP. Het modelleren werkt van begin tot eind. De
> ontwerpparameters zitten er nog niet in, structurele geologie (breuken,
> plooien) ook niet, de kaartimport werkt enkel voor Vlaanderen (DOV, elders
> importeer je GEF), en de exports heeft nog niemand anders dan ik nagekeken.
> Net daarom zoek ik ingenieurs in Belgie en Nederland die dit op een echt
> project willen loslaten en me zeggen waar het wringt.
>
> De gesloten beta draait al met een kleine groep. Wil je mee in de open
> beta: schrijf je in op strixgeo.com/download. Gratis en open source, en je
> krijgt een rechtstreekse lijn naar mij.
>
> #geotechniek #grondmodel #sondering #CPT #geotechnical

## LinkedIn post (English)

> StrixGeo is opening its beta.
>
> StrixGeo is a desktop tool that builds one ground model per project from
> CPTs, boreholes and lab data: import (or pull public Flanders DOV data off
> the map), correlate on cross-sections, subdivide into geotechnical units
> with CPT-derived packing classes, and export to your design tools with
> unit identifiers. Offline, your data stays on your disk.
>
> It is a minimum viable product. The modelling workflow is complete; the
> design-parameter side, structural geology (faults, folds) and validated
> exports are not there yet, and the map import covers Flanders only (DOV;
> elsewhere you import GEF). That is exactly the feedback I am after from
> engineers who model ground for a living in Belgium and the Netherlands.
>
> The closed beta is running with a small group. If you want in on the open
> beta, sign up at strixgeo.com/download. It is free and open source, and you
> get a direct line to me.
>
> #geotechnical #groundmodel #CPT #geotechniek

## Issue-report block (reuse on the site FAQ and in the manual)

Send to info@strixgeo.com: (1) the .strix file (File > Save), (2) the zip from
Help > Save logs for support, (3) what you did, what you expected, what
happened, plus a screenshot when it is visual. The manual chapter "Support and
reporting a problem" says the same in more words.
