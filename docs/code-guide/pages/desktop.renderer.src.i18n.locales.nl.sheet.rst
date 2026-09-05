desktop.renderer.src.i18n.locales.nl.sheet
==========================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/nl/sheet.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/nl/sheet.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-2

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/sheet.ts
   :language: typescript
   :lines: 1-2
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens ``SHEET_NL`` — the Dutch (Belgian) mirror of the English ``sheet`` catalogue, for the cross-section PDF sheet: the preview dialog and the printed sheet ("Profielblad"). It is the Dutch side.

**Why it is here.** The interface text lives in per-language catalogues so a component asks for a text by its key and gets the string for the active language, checked key-for-key against English by the ``localeParity`` test, per the rules in ``locales/nl/index.ts``.

.. CG-EXPLANATION-END id=module-header

``const SHEET_NL``
------------------

.. CG-BLOCK id=const:SHEET_NL lines=3-39

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/sheet.ts
   :language: typescript
   :lines: 3-39
   :lineno-match:

.. CG-EXPLANATION-START id=const:SHEET_NL

**What this does.** The Dutch strings for the section-sheet preview and print, key for key against English: the title, Export/Close, the fill choice ("Opvulling" — Lithologie vs Geotechnisch), the scale mode ("Passend op A3-hoogte" or explicit 1:H / 1:V scales) with its readout, the vertical-exaggeration and column-spacing labels, the title-block fields, the legend and the offline/too-wide/exported/failed messages. Values keep the same ``{hs}`` / ``{w}`` / ``{vex}`` slots as English.

**Why it is here.** The Dutch copy mirrors the English behaviour exactly — the too-wide message still names the width and the 5000 mm limit and points to packed spacing or a coarser scale. The vertical-datum label the level axis prints (m TAW) is BE/NL domain vocabulary the sheet needs verbatim, not a phrase to translate.

.. CG-EXPLANATION-END id=const:SHEET_NL

