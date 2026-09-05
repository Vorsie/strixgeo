desktop.renderer.src.i18n.locales.nl.sections
=============================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/nl/sections.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/nl/sections.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/sections.ts
   :language: typescript
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens ``SECTIONS_NL`` — the Dutch (Belgian) mirror of the English ``sections`` catalogue, for the cross-section stage: the profile canvas ("profielcanvas"), the toolbar, the detail panel, the profile header ("profielkop"), the context menus and the overlay hints. It is the Dutch side and, like its English twin, the largest single surface in the app.

**Why it is here.** The interface text lives in per-language catalogues so a component asks for a text by its key and gets the string for the active language, checked key-for-key against English by the ``localeParity`` test. It points to ``locales/nl/index.ts`` for the terminology rules.

.. CG-EXPLANATION-END id=module-header

``const SECTIONS_NL``
---------------------

.. CG-BLOCK id=const:SECTIONS_NL lines=6-930

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/sections.ts
   :language: typescript
   :lines: 6-930
   :lineno-match:

.. CG-EXPLANATION-START id=const:SECTIONS_NL

**What this does.** The Dutch strings for the whole cross-section stage — by far the longest catalogue — key for key against English: the section list and properties, the axis pill (Stratigraphy / Litho / Geotech), every toolbar verb and dropdown for all three axes, the export dropdown, the tie-section flow, the header channel toggles, the on-canvas hints, the context menus, the lens and band-edit dialogs and the family of result toasts. "Dwarsprofiel" is the section, and values keep the same ``{n}`` / ``{name}`` / ``{level}`` / ``{depth}`` slots as English.

**Why it is here.** The strings back the same owner rulings recorded on the English side — the body verbs are Join and "Ontkoppelen" (Un-join) only, the owner's approved word after "way too complicated" (2026-09-01), and the cross-body Join refusal is two messages picked by whether the soils differ. The model-level words are kept as their own keys so "No active {level} model" reads grammatically, since Dutch keeps the adjective before the noun just as English does.

.. CG-EXPLANATION-END id=const:SECTIONS_NL

