desktop.renderer.src.utils.verticalDatum
========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/verticalDatum.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/verticalDatum.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/utils/verticalDatum.ts
   :language: typescript
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A lookup from a vertical-datum EPSG code to the label the app shows next to a height value: 5710 becomes "m TAW" (Belgium) and 5709 becomes "m NAP" (Netherlands). The comment lists where the label is used — the chart's height axis, the borehole-log header, tooltips and the elevation editor. An EPSG number names a specific coordinate reference system, and a *vertical* datum is the zero-level heights are measured from.

**Why it is here.** The comment records the rule: this table stays in the presentation layer per the translate-at-the-boundary rule, because the backend always stores the datum as a plain EPSG integer; adding a country, or any special datum, is just one more entry here, since the only thing that changes is the user-facing label.

.. CG-EXPLANATION-END id=module-header

``const VCRS_LABEL_BY_EPSG``
----------------------------

.. CG-BLOCK id=const:VCRS_LABEL_BY_EPSG lines=14-20

.. literalinclude:: ../../../desktop/src/renderer/src/utils/verticalDatum.ts
   :language: typescript
   :lines: 14-20
   :lineno-match:

.. CG-EXPLANATION-START id=const:VCRS_LABEL_BY_EPSG

**What this does.** The table itself — two entries, 5710 → "m TAW" and 5709 → "m NAP" — followed by the comment that introduces the fallback below.

**Why it is here.** Naming the supported vertical datums in one table means every height label in the app is produced from a single source of truth.

.. CG-EXPLANATION-END id=const:VCRS_LABEL_BY_EPSG

``const VCRS_LABEL_FALLBACK``
-----------------------------

.. CG-BLOCK id=const:VCRS_LABEL_FALLBACK lines=21-26

.. literalinclude:: ../../../desktop/src/renderer/src/utils/verticalDatum.ts
   :language: typescript
   :lines: 21-26
   :lineno-match:

.. CG-EXPLANATION-START id=const:VCRS_LABEL_FALLBACK

**What this does.** The fallback label "m", used when the vertical EPSG is unknown or missing, followed by the comment that introduces the pickable-datum list.

**Why it is here.** The comment records the principle: better honest than wrong — never claim a datum we cannot identify — so an unrecognised height is labelled just "m".

.. CG-EXPLANATION-END id=const:VCRS_LABEL_FALLBACK

``const PICKABLE_VERTICAL_EPSGS``
---------------------------------

.. CG-BLOCK id=const:PICKABLE_VERTICAL_EPSGS lines=27-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/verticalDatum.ts
   :language: typescript
   :lines: 27-34
   :lineno-match:

.. CG-EXPLANATION-START id=const:PICKABLE_VERTICAL_EPSGS

**What this does.** The list of vertical EPSG codes the editor's datum-picker offers (5710 and 5709), followed by the comment introducing the horizontal list.

**Why it is here.** The comment records that this list is kept in step with the label table: were a datum in the lookup but not pickable, the engineer could see its label after the backend assigned it yet could not override to it. Today every supported datum is pickable.

.. CG-EXPLANATION-END id=const:PICKABLE_VERTICAL_EPSGS

``const PICKABLE_HORIZONTAL_EPSGS``
-----------------------------------

.. CG-BLOCK id=const:PICKABLE_HORIZONTAL_EPSGS lines=35-45

.. literalinclude:: ../../../desktop/src/renderer/src/utils/verticalDatum.ts
   :language: typescript
   :lines: 35-45
   :lineno-match:

.. CG-EXPLANATION-START id=const:PICKABLE_HORIZONTAL_EPSGS

**What this does.** The horizontal coordinate systems the project-metadata editor offers as the default for manual entries — Belgium Lambert 72 (31370) and Netherlands RD New (28992), each with a readable label — followed by the comment about the default below.

**Why it is here.** The comment records that these are the same two countries the vertical list covers and are co-located here so any future horizontal-CRS picker reuses one source list; adding a third country is a one-line entry here and in the default.

.. CG-EXPLANATION-END id=const:PICKABLE_HORIZONTAL_EPSGS

``const DEFAULT_PICKER_EPSG``
-----------------------------

.. CG-BLOCK id=const:DEFAULT_PICKER_EPSG lines=46-47

.. literalinclude:: ../../../desktop/src/renderer/src/utils/verticalDatum.ts
   :language: typescript
   :lines: 46-47
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_PICKER_EPSG

**What this does.** The datum the picker opens with when a row has no vertical EPSG yet, such as a fresh manual entry: 5710, m TAW.

**Why it is here.** The comment records that m TAW is the right default while the platform is Belgium-first, and that a later version could derive the default from the horizontal EPSG instead.

.. CG-EXPLANATION-END id=const:DEFAULT_PICKER_EPSG

``function verticalDatumLabel``
-------------------------------

.. CG-BLOCK id=function:verticalDatumLabel lines=48-55

.. literalinclude:: ../../../desktop/src/renderer/src/utils/verticalDatum.ts
   :language: typescript
   :lines: 48-55
   :lineno-match:

.. CG-EXPLANATION-START id=function:verticalDatumLabel

**What this does.** Returns the label for a given vertical EPSG: the fallback "m" when the code is missing, otherwise the table entry, or the fallback again when the code is not one it knows. It then documents the short form below.

**Why it is here.** This is the presentation-boundary lookup in action — the stored EPSG integer is turned into readable text only here, at the point of display.

.. CG-EXPLANATION-END id=function:verticalDatumLabel

``function verticalDatumShort``
-------------------------------

.. CG-BLOCK id=function:verticalDatumShort lines=56-61

.. literalinclude:: ../../../desktop/src/renderer/src/utils/verticalDatum.ts
   :language: typescript
   :lines: 56-61
   :lineno-match:

.. CG-EXPLANATION-START id=function:verticalDatumShort

**What this does.** The parenthesised short form for compact places (an axis tick "Level (TAW)", a tooltip "Level: 12.50 m TAW"): it takes the full label and strips the leading "m ", and returns an empty string when the datum is unknown.

**Why it is here.** The comment records that returning an empty string for an unknown datum lets the caller render a clean "Level (m)" or "Level: 12.50 m" without a stray token dangling.

.. CG-EXPLANATION-END id=function:verticalDatumShort

