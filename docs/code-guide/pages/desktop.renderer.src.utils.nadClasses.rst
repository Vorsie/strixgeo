desktop.renderer.src.utils.nadClasses
=====================================

.. CG-PAGE source=desktop/src/renderer/src/utils/nadClasses.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/nadClasses.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-52

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 1-52
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening docstring and the imports. This file is the lookup that turns a NAD geotechnical packing-class number into a name and a colour. NAD packing class 1 to 31 is a characterisation output — an engineer-facing description of the ground, not a design value. It imports the base-lithology label tables, the language selector, and the Dutch NAD tables.

**Why it is here.** The docstring records the translate-at-the-presentation-boundary rule: the engine stores the raw class integers 1 to 31 with the canonical Dutch labels, ported verbatim from the norm sheet, and this module is the single frontend translation point rendering them in English. It records the hard rule that the two vocabularies never cross (owner ruling 2026-08-26, "moderately firm sand just does not exist") — a granular soil (gravel, sand) is described by how densely it is packed, a cohesive soil (silt, clay, peat) by how firm it is. The published source of the classes is the Belgian national annex, NBN EN 1997-1 ANB Tabel 2.1. The colour ramp maps packing density to lightness within each soil family and is a placeholder for v1, but the class-to-colour mapping must never change shape because it is the stable identity key for the legend and band fills, and amber hues are forbidden here because amber is reserved across the app for the unsaved-state marker.

.. CG-EXPLANATION-END id=module-header

``const NAD_CLASS_NAMES``
-------------------------

.. CG-BLOCK id=const:NAD_CLASS_NAMES lines=53-110

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 53-110
   :lineno-match:

.. CG-EXPLANATION-START id=const:NAD_CLASS_NAMES

**What this does.** Maps each NAD class number (1 to 31) to its English packing-class label: gravel has 2 densities, sand 8, silt 8, clay 8, and peat 3.

**Why it is here.** The docstring records that these are the English translations of the engine's canonical Dutch labels; the class number is the stable join key into the Phase-5 parameter sheet while the label is presentation only, so translating it changes nothing downstream. A comment records that gravel has no loose or very-dense class because the Belgian annex gives gravel a single strength threshold where sand gets four bands.

.. CG-EXPLANATION-END id=const:NAD_CLASS_NAMES

``const NAD_CLASS_ABBR``
------------------------

.. CG-BLOCK id=const:NAD_CLASS_ABBR lines=111-161

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 111-161
   :lineno-match:

.. CG-EXPLANATION-START id=const:NAD_CLASS_ABBR

**What this does.** Maps each class (1 to 31) to a compact ``{SOIL}·{packing-abbreviation}`` label.

**Why it is here.** The docstring records that in a narrow geotech column the full name ("SAND, medium dense") truncates to just the soil ("SAND"), so a litho unit split into several packing classes would show bands that read identically and differ only by near-adjacent colour shades — correlating on colour alone. The compact form keeps the packing class on one short line that survives truncation, while the full name stays available for the hover tooltip so the abbreviations are never the only expansion.

.. CG-EXPLANATION-END id=const:NAD_CLASS_ABBR

``const _NAD_CLASS_COLORS``
---------------------------

.. CG-BLOCK id=const:_NAD_CLASS_COLORS lines=162-201

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 162-201
   :lineno-match:

.. CG-EXPLANATION-START id=const:_NAD_CLASS_COLORS

**What this does.** Maps each class (1 to 31) to a hex fill colour — a density-to-lightness ramp within each soil family, lightest for the loosest and darkest for the densest.

**Why it is here.** The comment records that it is a placeholder v1 palette, that the sand ramp is deliberately shifted away from the base amber to avoid confusion with the unsaved marker, and that an unknown class maps to mid-grey; a designer should refine it, but the class-to-colour mapping must keep its shape.

.. CG-EXPLANATION-END id=const:_NAD_CLASS_COLORS

``const _NULL_CLASS_COLOR``
---------------------------

.. CG-BLOCK id=const:_NULL_CLASS_COLOR lines=202-225

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 202-225
   :lineno-match:

.. CG-EXPLANATION-START id=const:_NULL_CLASS_COLOR

**What this does.** The single neutral mid-grey used for a degenerate null class — a lithology with no CPTs.

**Why it is here.** The comment records that it is the same mid-grey as the lithology fallback colour.

.. CG-EXPLANATION-END id=const:_NULL_CLASS_COLOR

``function nadClassName``
-------------------------

.. CG-BLOCK id=function:nadClassName lines=226-239

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 226-239
   :lineno-match:

.. CG-EXPLANATION-START id=function:nadClassName

**What this does.** Returns the packing-class label for a class number in the active or requested language; an empty string for a null class; and a safe ``NAD {n}`` for any out-of-range integer.

**Why it is here.** The docstring records that a null class is a rare degenerate case (no CPTs for a lithology — boreholes are classified by extrapolating the nearest CPT, so null is never the normal borehole case), and that returning an empty string for null lets the caller decide whether to draw a label at all: the band overlay draws none for an empty string, the inspector shows a neutral swatch. Passing English explicitly gives a language-stable value, which the logic, reverse-map and sort paths rely on.

.. CG-EXPLANATION-END id=function:nadClassName

``function nadNamesFor``
------------------------

.. CG-BLOCK id=function:nadNamesFor lines=240-256

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 240-256
   :lineno-match:

.. CG-EXPLANATION-START id=function:nadNamesFor

**What this does.** Returns the name table for a language — the Dutch source tokens for Dutch, the English presentation table for every other locale.

**Why it is here.** The docstring records that selecting the table, never inventing a label, is the whole translation, per the domain-token rule in the UX design note.

.. CG-EXPLANATION-END id=function:nadNamesFor

``function nadCompactLabel``
----------------------------

.. CG-BLOCK id=function:nadCompactLabel lines=257-270

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 257-270
   :lineno-match:

.. CG-EXPLANATION-START id=function:nadCompactLabel

**What this does.** Returns the compact ``{SOIL}·{packing}`` label for a class in the active language; an empty string for null; ``NAD {n}`` for an out-of-range class.

**Why it is here.** The docstring records that it is the language-aware twin of a bare compact-table lookup, for a render site that holds the class number rather than the full name, and that under Dutch the soil prefix is the Dutch source token.

.. CG-EXPLANATION-END id=function:nadCompactLabel

``const _NAD_NAME_SPLIT``
-------------------------

.. CG-BLOCK id=const:_NAD_NAME_SPLIT lines=271-283

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 271-283
   :lineno-match:

.. CG-EXPLANATION-START id=const:_NAD_NAME_SPLIT

**What this does.** The separator — a comma and a space — at which a canonical name divides into its soil word and its packing phrase.

**Why it is here.** The comment records that the canonical names are all shaped ``{SOIL}, {packing}``, so splitting at the first comma is the soil/packing boundary for all 31 entries, and this keeps the name table the single source of truth instead of a second parallel table to edit.

.. CG-EXPLANATION-END id=const:_NAD_NAME_SPLIT

``function nadSoilFamilyName``
------------------------------

.. CG-BLOCK id=function:nadSoilFamilyName lines=284-304

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 284-304
   :lineno-match:

.. CG-EXPLANATION-START id=function:nadSoilFamilyName

**What this does.** Returns the soil-family word of a class ("SAND" for classes 5 to 12) by taking the name up to the first separator; an empty string for null; the whole fallback for an out-of-range integer.

**Why it is here.** The docstring records that it is a helper for grouped legends: the family header shows the soil and the rows beneath show the packing, so neither repeats the other.

.. CG-EXPLANATION-END id=function:nadSoilFamilyName

``function nadPackingLabel``
----------------------------

.. CG-BLOCK id=function:nadPackingLabel lines=305-327

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 305-327
   :lineno-match:

.. CG-EXPLANATION-START id=function:nadPackingLabel

**What this does.** Returns the packing part of the name — the text after the first separator — so "SAND, medium dense" gives "medium dense" and "SILT, sandy, fairly firm" gives "sandy, fairly firm".

**Why it is here.** The docstring records that the admixture variant belongs on the packing side because it is what distinguishes one class from another within the same soil, and that null returns an empty string so the caller decides what an unclassified row says.

.. CG-EXPLANATION-END id=function:nadPackingLabel

``const UNCLASSIFIED_QUALIFIER``
--------------------------------

.. CG-BLOCK id=const:UNCLASSIFIED_QUALIFIER lines=328-330

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 328-330
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNCLASSIFIED_QUALIFIER

**What this does.** The English wording a unit with no packing class shows instead of nothing: "not yet classified".

**Why it is here.** The docstring records that a geotech unit exists before it is classified — the borehole materialiser creates one per litho unit and leaves the class null when no cone reached that soil — and that the raw table lookup answers an empty string for null (the band overlay draws no label), so a roster that asked IT for the row text rendered blank rows in the owner's geotech-units pane (2026-08-26). Blank is the one thing these rows must not be, because they are the ledger of ground not yet classified, so the row must name the ground and state the gap.

.. CG-EXPLANATION-END id=const:UNCLASSIFIED_QUALIFIER

``const UNCLASSIFIED_SEPARATOR``
--------------------------------

.. CG-BLOCK id=const:UNCLASSIFIED_SEPARATOR lines=331-351

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 331-351
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNCLASSIFIED_SEPARATOR

**What this does.** The separator joining the soil word to the unclassified qualifier, producing "SAND — not yet classified".

**Why it is here.** It builds the unclassified roster label so the soil and the gap read as one phrase.

.. CG-EXPLANATION-END id=const:UNCLASSIFIED_SEPARATOR

``function geotechUnitSoil``
----------------------------

.. CG-BLOCK id=function:geotechUnitSoil lines=352-383

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 352-383
   :lineno-match:

.. CG-EXPLANATION-START id=function:geotechUnitSoil

**What this does.** Returns the soil-family word for a geotech unit: from the class name when the unit is classified, otherwise from its inherited litho soil code translated and upper-cased, and failing both from the unit's stored name.

**Why it is here.** The docstring records that a geotech unit knows its soil twice over and the two answers must agree, so this is the single place that picks between them; the litho code yields the same five soil words, so an unclassified skeleton groups under the same header as the classified units of its own ground, and falling back to the stored name keeps the unit identified rather than reduced to an empty header.

.. CG-EXPLANATION-END id=function:geotechUnitSoil

``function nadClassQualifier``
------------------------------

.. CG-BLOCK id=function:nadClassQualifier lines=384-416

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 384-416
   :lineno-match:

.. CG-EXPLANATION-START id=function:nadClassQualifier

**What this does.** Returns the packing part of a class name — the soil word removed — for a roster row; the unclassified wording for null; ``NAD {n}`` for an out-of-range integer.

**Why it is here.** The docstring records that the roster nests classes under a soil header, so repeating the soil on every child row is noise; the classified case delegates to the packing-label helper (one split, one source of truth), and the null case returns the unclassified wording rather than an empty string because a roster row, unlike a band label, must never be blank.

.. CG-EXPLANATION-END id=function:nadClassQualifier

``function geotechUnitLabel``
-----------------------------

.. CG-BLOCK id=function:geotechUnitLabel lines=417-445

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 417-445
   :lineno-match:

.. CG-EXPLANATION-START id=function:geotechUnitLabel

**What this does.** Returns the roster display name for a geotech unit, and never an empty string: the packing-class name when classified, otherwise "{SOIL} — not yet classified", optionally followed by the source litho unit in parentheses.

**Why it is here.** The docstring records that this is the formatter every geotech roster surface uses (inspector rows, the selected-body panel, the 3D legend), while the raw table lookup stays the one that answers an empty string for null because the section band overlay relies on an empty label meaning "draw no text". The source-litho name is a disambiguator, passed only when several unclassified units of the same soil appear together — the owner's project has five "KLEI (geotech)" skeletons from different formations that would otherwise read as five copies of one row — so passing it unconditionally would put a parenthetical on rows with nothing to be told apart from.

.. CG-EXPLANATION-END id=function:geotechUnitLabel

``function nadClassColor``
--------------------------

.. CG-BLOCK id=function:nadClassColor lines=446-470

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 446-470
   :lineno-match:

.. CG-EXPLANATION-START id=function:nadClassColor

**What this does.** Returns a fixed hex colour for a class number, and the neutral mid-grey for null, undefined, or an out-of-range class.

**Why it is here.** The docstring records that the palette encodes packing density as lightness within each soil family and is a placeholder v1 palette for the geotech bands and legend, and that null returns the degenerate-band mid-grey (no CPTs for the lithology).

.. CG-EXPLANATION-END id=function:nadClassColor

``function geotechUnitColor``
-----------------------------

.. CG-BLOCK id=function:geotechUnitColor lines=471-501

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 471-501
   :lineno-match:

.. CG-EXPLANATION-START id=function:geotechUnitColor

**What this does.** Returns the colour a geotech unit is drawn in: the engineer's explicitly picked colour when there is one, otherwise the automatic NAD packing colour.

**Why it is here.** The docstring records that this is the one rule for every surface — the pane swatch, the section fills, the 3D solids, the legend — following the owner ruling of 2026-08-26 that pane colours must be choosable. The pick is a separate field rather than a comparison against the automatic colour so the engineer may choose exactly the colour the ramp would have produced and have it survive a later class change, and the unit's own ``color`` field is deliberately NOT consulted because on a geotech unit it holds the lithology colour the materialiser copied at create — a machine default that says nothing about intent.

.. CG-EXPLANATION-END id=function:geotechUnitColor

``function nadColoredFormations``
---------------------------------

.. CG-BLOCK id=function:nadColoredFormations lines=502-516

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 502-516
   :lineno-match:

.. CG-EXPLANATION-START id=function:nadColoredFormations

**What this does.** Returns copies of the given formations with each one's ``color`` replaced by the colour the unit is actually drawn in, leaving every other field — including the colour override — untouched.

**Why it is here.** The docstring records that this is a presentation-boundary transform for the 3D geotech body viewer: a geotech formation stores the lithology colour it inherited from its source, but a geotech body must be coloured by its NAD class (or the engineer's pick), and the 3D viewer colours each solid by a display colour falling back to the formation colour, matched by id — so recolouring the formations here is the seam that reaches the built 3D bodies with no backend or viewer change. The input is never mutated (a shallow copy per formation) and the override field is carried through so a downstream consumer can still tell a pick from a default.

.. CG-EXPLANATION-END id=function:nadColoredFormations

``const _FULLNAME_TO_COMPACT``
------------------------------

.. CG-BLOCK id=const:_FULLNAME_TO_COMPACT lines=517-536

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 517-536
   :lineno-match:

.. CG-EXPLANATION-START id=const:_FULLNAME_TO_COMPACT

**What this does.** A reverse lookup from a full NAD name to its compact label, built once from the parallel 1-to-31 tables in both languages.

**Why it is here.** The comment records that it lets a render site holding only the full formation name (the section band label) derive the compact form without threading the class number through the band, and that both languages are keyed because the band name is itself a display name — Dutch under Dutch — so the map is language-independent by covering every language rather than by ignoring language. It is an exact-name lookup, with no string parsing.

.. CG-EXPLANATION-END id=const:_FULLNAME_TO_COMPACT

``function nadCompactFromName``
-------------------------------

.. CG-BLOCK id=function:nadCompactFromName lines=537-548

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 537-548
   :lineno-match:

.. CG-EXPLANATION-START id=function:nadCompactFromName

**What this does.** Translates a full NAD name ("SAND, medium dense") to its compact form ("SAND·MD"); any string that is not a known NAD name is returned unchanged.

**Why it is here.** The docstring records that returning non-NAD names verbatim — like the "ZAND (geotech)" fallback for an unclassified band, or a non-geotech formation name — lets the caller apply this unconditionally on the geotech axis.

.. CG-EXPLANATION-END id=function:nadCompactFromName

``const NAD_FAMILY_RANGES``
---------------------------

.. CG-BLOCK id=const:NAD_FAMILY_RANGES lines=549-566

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 549-566
   :lineno-match:

.. CG-EXPLANATION-START id=const:NAD_FAMILY_RANGES

**What this does.** The class-number range of each soil family: gravel 1 to 4, sand 5 to 12, silt 13 to 20, clay 21 to 28, peat 29 to 31.

**Why it is here.** The docstring records that a hand-set class must stay inside its band's own soil family; the server validates against the norm table, and this map only drives the MENU so it never offers a class the server would refuse. The class numbers are stable facts of the Belgian annex table.

.. CG-EXPLANATION-END id=const:NAD_FAMILY_RANGES

``const NAD_SOIL_FAMILY_ORDER``
-------------------------------

.. CG-BLOCK id=const:NAD_SOIL_FAMILY_ORDER lines=567-584

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 567-584
   :lineno-match:

.. CG-EXPLANATION-START id=const:NAD_SOIL_FAMILY_ORDER

**What this does.** The soil-family words in class-number order — gravel, sand, silt, clay, peat — derived from the ranges above.

**Why it is here.** The docstring records that deriving it from the ranges rather than hand-listing it means it can never drift from the name table, and that grouped legends sort their family rows by this order (the norm's own order). A comment records that it is a logic order, so it is pinned to English and must never shift with the interface language.

.. CG-EXPLANATION-END id=const:NAD_SOIL_FAMILY_ORDER

``const _RANGE_BY_SOIL_CODE``
-----------------------------

.. CG-BLOCK id=const:_RANGE_BY_SOIL_CODE lines=585-612

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 585-612
   :lineno-match:

.. CG-EXPLANATION-START id=const:_RANGE_BY_SOIL_CODE

**What this does.** A map from a raw soil code (like ``ZAND``) to that soil's class-number range, built from the lithology labels and the family ranges.

**Why it is here.** The comment records that it is derived from the two tables that already exist — the label translates the code to the English word, and the family range's first class reports that same word — so it is not a third statement of the soil-to-class coupling and therefore cannot drift from the other two.

.. CG-EXPLANATION-END id=const:_RANGE_BY_SOIL_CODE

``function nadClassesForSoil``
------------------------------

.. CG-BLOCK id=function:nadClassesForSoil lines=613-633

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 613-633
   :lineno-match:

.. CG-EXPLANATION-START id=function:nadClassesForSoil

**What this does.** Returns every NAD class a unit of a given soil may carry, in ascending order; an empty list for a missing soil or one the norm table does not know.

**Why it is here.** The docstring records the owner ruling of 2026-08-26 that a sand body can never carry a silt packing class — "the NAD coupling is absolute" — so the ground decides the menu, not whatever class the band happens to hold. It is the frontend twin of the backend's own settable-classes helper, and it returns nothing for an unknown soil rather than guessing a family.

.. CG-EXPLANATION-END id=function:nadClassesForSoil

``function nadClassIsForeignToSoil``
------------------------------------

.. CG-BLOCK id=function:nadClassIsForeignToSoil lines=634-642

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClasses.ts
   :language: typescript
   :lines: 634-642
   :lineno-match:

.. CG-EXPLANATION-START id=function:nadClassIsForeignToSoil

**What this does.** Answers whether a class sits on ground of a different soil family — a "stranger" — returning true only when both families are known and they differ.

**Why it is here.** The docstring records that two cases are deliberately not strangers because neither has a foreign family to convict: an unclassified band with no class at all, and a unit whose soil the norm table does not know. It mirrors the backend predicate so the two surfaces agree about which rows are legacy strangers.

.. CG-EXPLANATION-END id=function:nadClassIsForeignToSoil

