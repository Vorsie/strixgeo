desktop.renderer.src.components.borelog.components.Legend
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/borelog/components/Legend.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/borelog/components/Legend.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/Legend.tsx
   :language: tsx
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's imports and its documentation comment. It pulls in a warning icon, the borehole type, the drill-method and soil colour lookups, the soil-pattern definitions, the lithology and stratigraphy type sets, the lab-test icon table, the translation helper, and the small ``LegendChip`` and ``LegendSection`` pieces. The comment says this is the legend at the bottom of the log and lists its four sections — lithology codes, stratigraphy formation codes, drill methods, and lab-test glyphs — plus an inline amber warning when the borehole has no surface elevation.

**Why it is here.** The comment records the key rule: each section is shown only when the borehole actually has rows in that category, so a stratigraphy-only borehole never gets an empty "Lithology codes" panel. The amber elevation warning is there because the log still draws without a surface elevation, just without the absolute-level axis, and the user should know that is what they are missing — amber for attention, not red.

.. CG-EXPLANATION-END id=module-header

``function Legend``
-------------------

.. CG-BLOCK id=function:Legend lines=31-162

.. literalinclude:: ../../../desktop/src/renderer/src/components/borelog/components/Legend.tsx
   :language: tsx
   :lines: 31-162
   :lineno-match:

.. CG-EXPLANATION-START id=function:Legend

**What this does.** The legend component. It scans the borehole to collect the soil codes used in any lithology layer, the stratigraphy formation codes (taken as the prefix of each description), the drill methods used, and which lab-test icons actually appear on a sample. If none of those are present it draws nothing. Otherwise it draws one section per non-empty category, each filled with chips showing the code, its label and a small colour or pattern preview, and finally the amber missing-elevation warning when the surface elevation is absent.

**Why it is here.** Only non-empty categories are drawn — the whole legend collapses away when there is nothing to legend — which is the rule stated in the header. The soil, drill-method and lab-test lookups map raw tokens to their colours and labels at the presentation boundary, so the engine keeps the original codes while the desktop chooses how they appear. The amber warning repeats the elevation caveat where the user is already reading the legend.

.. CG-EXPLANATION-END id=function:Legend

