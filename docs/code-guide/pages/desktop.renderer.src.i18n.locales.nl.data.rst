desktop.renderer.src.i18n.locales.nl.data
=========================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/nl/data.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/nl/data.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/data.ts
   :language: typescript
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens ``DATA_NL`` — the Dutch (Belgian) mirror of the English ``data`` catalogue. It carries the same keys, with Belgian-Flemish strings, for the Data stage: the import verbs and the map/chart canvas. It is the Dutch side.

**Why it is here.** The interface text lives in per-language catalogues so a component asks for a text by its key and gets the string for the active language, checked key-for-key against English by the ``localeParity`` test. The header notes this file is WIRED (the DataToolbar reads these keys today) and points to ``locales/nl/index.ts`` for the terminology rules.

.. CG-EXPLANATION-END id=module-header

``const DATA_NL``
-----------------

.. CG-BLOCK id=const:DATA_NL lines=6-146

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/data.ts
   :language: typescript
   :lines: 6-146
   :lineno-match:

.. CG-EXPLANATION-START id=const:DATA_NL

**What this does.** The Dutch strings for the Data stage, key for key against English: the import toolbar (with "Importeren" and "Kader tekenen…" for drawing the DOV bounding box), the canvas tabs, the DOV import-status panel, the import-result and load-failure toasts, the overlay-persistence failures, and the inspector's search, sort, empty-state and date-range strings. Values keep the same ``{n}`` / ``{name}`` slots as English.

**Why it is here.** The header carries the file's most-discussed judgement call: the import verb is FLAGGED because the owner writes "sonderingen" (BE practice says sondering) while the GEF menu label reads "CPT importeren (.gef)", and the owner has to settle which wins. The domain-canon rule still holds — soil names and DOV codes are shown as recorded, translated only at the presentation boundary, never in this file.

.. CG-EXPLANATION-END id=const:DATA_NL

