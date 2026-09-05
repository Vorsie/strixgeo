desktop.renderer.src.i18n.locales.en.data
=========================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/en/data.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/en/data.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/data.ts
   :language: typescript
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens the ``DATA`` catalogue — the long list that pairs each on-screen text with a short internal name (its key). This one holds the words for the Data stage: the import verbs and the map/chart canvas where CPTs and boreholes come in, whether from local files or straight from DOV. It is the English side.

**Why it is here.** The interface text lives in per-language catalogues so a component asks for a text by its key and gets the string for the active language; the header notes this file is WIRED, meaning the DataToolbar reads these keys in the running app today (many other catalogues are written ahead of their components being rewired). It points to ``locales/en/index.ts`` for the key-naming rules and the domain-canon carve-out — soil names and DOV codes are shown as their raw tokens, translated only at the presentation boundary, never here.

.. CG-EXPLANATION-END id=module-header

``const DATA``
--------------

.. CG-BLOCK id=const:DATA lines=7-140

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/en/data.ts
   :language: typescript
   :lines: 7-140
   :lineno-match:

.. CG-EXPLANATION-START id=const:DATA

**What this does.** The key-to-text pairs for the Data stage, grouped by comment banner: the import toolbar verbs and canvas tabs (``data.toolbar.*`` / ``data.canvas.*``); the DOV import-status panel; the result toasts that report how many investigations were imported, already existed, failed or were refreshed; the load-failure toasts; the map overlay-persistence failures; the inspector's search, bulk-select, sort, empty-state and date-range strings; and the extra map-view labels not already covered by the shared ``map.*`` keys. A value with a ``{n}`` or ``{name}`` slot is filled in at display time.

**Why it is here.** Each toast is composed from small count-fragments (``{n} imported``, ``{n} already existed``…) joined together, and the count-words are split into one/many keys, so the sentence pluralises correctly in every language on its own. The comments record where a message is deliberately broken into chunks — the "no hillshade for this CRS" hint is split around styled spans (the CRS label and two EPSG codes) and Dutch reorders "Set … to …" into the separable "Stel … in op …", which is why the intro and "to" chunks are separate keys.

.. CG-EXPLANATION-END id=const:DATA

