# Closed beta launch — playbook (2026-09-05)

Owner rulings behind this file (2026-09-05 evening): no video tutorials for
the closed beta; installer #17 is the launch build if it survives the owner's
final review project (which doubles as the shipped worked example); everything
goes to `main`; backwards compatibility is re-armed from #17 on
(`docs/backwards-compat.md`); the site gets an open-beta sign-up; testers get
a mail with a download link, a personal key, and the way to report a problem.
Keys are never written anywhere but the gitignored key file on the activation
server side; this playbook holds no key.

## Sequence

1. `develop` green, pushed (integration gate). Installer #17 built and its
   stamp + git SHA verified. Owner runs the final review project in the
   client on #17 and saves it as the worked example
   (`desktop/resources/sample/worked-example.strix`; the welcome card shows it
   once the file exists). If the sample must ship inside the installer, that
   is installer #18 built from the same source plus the file.
2. Fast-forward `develop` into `main`; tag `v0.1.0-beta.1`. From here the
   branch model in CLAUDE.md applies (features off `develop`, releases as
   fast-forwards into `main`).
3. Publish the installer to the public releases repo
   (`Vorsie/strixgeo-releases`, `npm run release` after the version bump), so
   the updater feed and the download link exist. Unsigned: the mail says so.
4. Site update live (see the site repo): download page in its two-state form,
   the manual under `/manual/`, videos marked pending, open-beta sign-up wired
   to the MailerLite form the owner creates.
5. Mail the cohort (template below), one mail per tester, key pasted by hand
   from the key file. Keep a private sheet: tester, key issued, date, replies.
6. LinkedIn post (below) the same day, or the day after the first testers
   confirm the installer runs.

## Mail to a closed-beta tester

Subject: StrixGeo closed beta: your download link and key

Hi <first name>,

Thanks for testing StrixGeo. Below is everything you need for the closed
beta. Please keep the key to yourself; it is personal and activates one
machine.

Download (Windows 10/11, 64-bit): <release URL>

Your key: <key>

The installer is not code-signed yet, so Windows SmartScreen will warn you.
Click "More info" and then "Run anyway". At first start the app asks for the
key; after that it works offline. The key runs for <duration> from the day
you activate it. The beta build itself has an expiry date; the app warns you a
week ahead and Help > Check for updates installs the next build.

What I ask of you: use it on a real project, from import to a cross-section
and, if you get there, a 3D model and an export. Nothing you do is uploaded;
the project file stays on your disk.

When something goes wrong, send me three things at info@strixgeo.com:

1. the project file (File > Save, attach the .strix file),
2. the logs (Help > Save logs for support..., attach the zip it writes),
3. two or three sentences: what you did, what you expected, what happened.
   A screenshot helps when the problem is visual.

Questions of any kind go to the same address; you get me, not a ticket
system. The user manual is at https://strixgeo.com/manual/.

This is a minimum viable product. The modelling workflow is complete; the
design-parameter side is deliberately not there yet, and the exports have not
been validated by anyone but me. Your judgment on both is what I am after.

Robin

### Dutch version

Onderwerp: StrixGeo gesloten beta: je downloadlink en sleutel

Dag <voornaam>,

Bedankt om StrixGeo te testen. Hieronder staat alles wat je nodig hebt voor
de gesloten beta. Hou de sleutel voor jezelf; hij is persoonlijk en activeert
een machine.

Download (Windows 10/11, 64-bit): <release URL>

Je sleutel: <key>

De installer is nog niet gesigneerd, dus Windows SmartScreen zal waarschuwen.
Klik op "Meer informatie" en daarna op "Toch uitvoeren". Bij de eerste start
vraagt de app de sleutel; daarna werkt alles offline. De sleutel loopt
<duur> vanaf de dag dat je activeert. De betabuild zelf heeft een vervaldatum;
de app waarschuwt een week op voorhand en Help > Check for updates installeert
de volgende build.

Wat ik vraag: gebruik het op een echt project, van import tot een
dwarsprofiel en, als je zover raakt, een 3D-model en een export. Niets wat je
doet wordt geupload; het projectbestand blijft op je schijf.

Als er iets misloopt, stuur me drie dingen naar info@strixgeo.com:

1. het projectbestand (File > Save, voeg het .strix-bestand toe),
2. de logs (Help > Save logs for support..., voeg de zip toe die hij schrijft),
3. twee of drie zinnen: wat je deed, wat je verwachtte, wat er gebeurde.
   Een schermafbeelding helpt als het probleem visueel is.

Vragen van elke soort mogen naar hetzelfde adres; je krijgt mij, geen
ticketsysteem. De handleiding staat op https://strixgeo.com/manual/.

Dit is een minimum viable product. De modelleerflow is compleet; de kant van
de ontwerpparameters is bewust nog niet aanwezig, en de exports zijn door
niemand anders dan mij gevalideerd. Jouw oordeel over beide is wat ik zoek.

Robin

## LinkedIn post: open-beta call

English:

> StrixGeo is opening its beta.
>
> StrixGeo is a desktop tool that builds one ground model per project from
> CPTs, boreholes and lab data: import (or pull public Flanders DOV data off
> the map), correlate on cross-sections, subdivide into geotechnical units
> with CPT-derived packing classes, and export to your design tools with
> unit identifiers. Offline, your data stays on your disk.
>
> It is a minimum viable product. The modelling workflow is complete; the
> design-parameter side and validated exports are not there yet, and that is
> exactly the feedback I am after from engineers who model ground for a
> living in Belgium and the Netherlands.
>
> The closed beta is running with a small group. If you want in on the open
> beta, sign up at strixgeo.com/download. It is free during the beta; you get
> a personal key and a direct line to me.
>
> #geotechnical #groundmodel #CPT #geotechniek

Dutch:

> StrixGeo opent zijn beta.
>
> StrixGeo is een desktoptool die per project een grondmodel bouwt uit
> sonderingen, boringen en labodata: importeren (of publieke DOV-data van
> Vlaanderen rechtstreeks van de kaart halen), correleren op dwarsprofielen,
> onderverdelen in geotechnische eenheden met pakkingsklassen afgeleid uit
> de sondering, en exporteren naar je rekentools met eenheidsidentificaties.
> Offline, je data blijft op je schijf.
>
> Het is een minimum viable product. De modelleerflow is compleet; de
> ontwerpparameters en gevalideerde exports zijn er nog niet, en net daar
> zoek ik de feedback van ingenieurs die in Belgie en Nederland dagelijks
> grond modelleren.
>
> De gesloten beta loopt met een kleine groep. Wil je mee in de open beta,
> schrijf je in op strixgeo.com/download. Gratis tijdens de beta; je krijgt
> een persoonlijke sleutel en een rechtstreekse lijn naar mij.
>
> #geotechniek #grondmodel #sondering #geotechnical

## Issue-report block (reuse on the site FAQ and in the manual)

Send to info@strixgeo.com: (1) the .strix file (File > Save), (2) the zip from
Help > Save logs for support..., (3) what you did, what you expected, what
happened, plus a screenshot when it is visual. The manual chapter "Support and
reporting a problem" says the same in more words.
