desktop.renderer.src.i18n.locales.nl.panels
===========================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/nl/panels.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/nl/panels.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/panels.ts
   :language: typescript
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens ``PANELS_NL`` — the Dutch (Belgian) mirror of the English ``panels`` catalogue, for the detail panels and dialogs reachable from more than one stage: the map, the borehole log ("boorstaat"), the lab tests, the elevation editor ("peileditor"), the composition and formation pickers, the shared confirmation dialogs, the undo labels and the shortcuts cheatsheet ("sneltoetsenoverzicht"). It is the Dutch side.

**Why it is here.** The interface text lives in per-language catalogues so a component asks for a text by its key and gets the string for the active language, checked key-for-key against English by the ``localeParity`` test. It points to ``locales/nl/index.ts`` for the terminology rules.

.. CG-EXPLANATION-END id=module-header

``const PANELS_NL``
-------------------

.. CG-BLOCK id=const:PANELS_NL lines=8-335

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/panels.ts
   :language: typescript
   :lines: 8-335
   :lineno-match:

.. CG-EXPLANATION-START id=const:PANELS_NL

**What this does.** The Dutch strings for the shared panels, key for key against English, under the same group banners — map (opening with "Achtergrondkaart" for basemap), borehole log and CPT chart, lab tests, elevation editor, composition and formation dialogs, the shared confirmation dialogs, the undo-action labels and the cheatsheet. Values keep the same ``{name}`` / ``{depth}`` / ``{n}`` slots as English.

**Why it is here.** The borehole observation-track labels translate only the display label while the DOV ``observation_type`` token stays raw in the domain, with an unknown token falling back to the raw token — the presentation-boundary rule in miniature. Dialog sentences that wrap a bold count keep the same split keys as English so the number can be emphasised and the phrase can reorder into Dutch.

.. CG-EXPLANATION-END id=const:PANELS_NL

