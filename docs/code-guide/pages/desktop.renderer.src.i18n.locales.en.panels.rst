desktop.renderer.src.i18n.locales.en.panels
===========================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/en/panels.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/en/panels.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/panels.ts
   :language: typescript
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens the ``PANELS`` catalogue — the words for the detail panels and dialogs reachable from more than one stage: the map, the borehole log and CPT chart, the lab-test panels, the elevation editor, the composition and formation pickers, the shared confirmation dialogs, the undo-action labels and the F1 gestures cheatsheet. It is the English side.

**Why it is here.** The interface text lives in per-language catalogues so a component asks for a text by its key and gets the string for the active language. Gathering the shared panels in one file keeps a text that is used from several stages defined once. It cites ``locales/en/index.ts`` for the key-naming rules and the domain-canon carve-out — DOV codes and soil terms are shown as their raw tokens, translated only at the presentation boundary.

.. CG-EXPLANATION-END id=module-header

``const PANELS``
----------------

.. CG-BLOCK id=const:PANELS lines=8-304

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/panels.ts
   :language: typescript
   :lines: 8-304
   :lineno-match:

.. CG-EXPLANATION-START id=const:PANELS

**What this does.** The key-to-text pairs for the shared panels, grouped by comment banner: the map and DOV import-progress panel (``map.*``); the borehole log and CPT chart, including the observation-track display labels and the chart axis/tooltip chrome (``borelog.*`` / ``chart.*``); the lab-test panels (``lab.*``); the elevation editor (``elevation.*``); the litho composition and formation dialogs (``composition.*`` / ``formation.*``); the confirmation dialogs shared across surfaces (``dialog.*``), including the CPT refresh-on-reimport diff; the undo-stack action labels (``undo.*``); and the cheatsheet (``cheatsheet.*``). Values with ``{name}``, ``{depth}`` or ``{n}`` slots are filled in at display time.

**Why it is here.** The observation-track labels translate only the rendered label while the underlying DOV ``observation_type`` token stays raw in the domain, and an unknown token falls back to showing the raw token — the presentation-boundary rule in miniature. Several dialog sentences are split around a bold count so the number can be emphasised and the phrase can reorder in Dutch (for example ``dialog.cptRefreshTitlePre`` / ``…Post`` wrap the CPT name).

.. CG-EXPLANATION-END id=const:PANELS

