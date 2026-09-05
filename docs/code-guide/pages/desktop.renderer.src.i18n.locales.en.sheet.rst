desktop.renderer.src.i18n.locales.en.sheet
==========================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/en/sheet.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/en/sheet.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-2

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/sheet.ts
   :language: typescript
   :lines: 1-2
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens the ``SHEET`` catalogue — the words for the cross-section PDF sheet: the preview dialog and the printed sheet itself. It is the English side.

**Why it is here.** The interface text lives in per-language catalogues so a component asks for a text by its key and gets the string for the active language, per the rules in ``locales/en/index.ts``.

.. CG-EXPLANATION-END id=module-header

``const SHEET``
---------------

.. CG-BLOCK id=const:SHEET lines=3-39

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/sheet.ts
   :language: typescript
   :lines: 3-39
   :lineno-match:

.. CG-EXPLANATION-START id=const:SHEET

**What this does.** The key-to-text pairs for the section-sheet preview and print: the title and Export/Close buttons, the fill choice (Lithology vs Geotechnical), the scale mode (fit to A3 height vs set explicit 1:H and 1:V scales) with its readout, the vertical-exaggeration and column-spacing labels, the paper-size and scale lines, the title-block fields (Project, Profile, Client, Date, Author), the legend, and the offline/too-wide/exported/failed messages. Values with ``{hs}``, ``{w}`` or ``{vex}`` slots are filled in at display time.

**Why it is here.** The too-wide message names the width and the 5000 mm limit and suggests packed spacing or a coarser horizontal scale, so the engineer is told exactly how to bring an over-size sheet back in bounds. ``sheet.mTaw`` is the vertical-datum label the level axis prints — a small piece of BE/NL domain vocabulary that the sheet needs verbatim.

.. CG-EXPLANATION-END id=const:SHEET

