desktop.renderer.src.i18n.locales.nl.tutorial
=============================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/nl/tutorial.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/nl/tutorial.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/tutorial.ts
   :language: typescript
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens ``TUTORIAL_NL`` — the Dutch (Belgian) mirror of the English ``tutorial`` catalogue, for the guided tour: the chapter titles (opening "Je project", "Data importeren", "Dwarsprofielen"…), the coach-card chrome, and a title-and-body for every step. Like the launch mirror it is typed as a partial list keyed against the English ``TUTORIAL``. It is the Dutch side.

**Why it is here.** Being typed a partial (``Partial<Record<keyof typeof TUTORIAL, string>>``) is checked before the app runs: a Dutch key that does not exist in English is refused, and an English key missing here falls back to English at run time, so an unfinished translation still works. The header records that the wording is a DRAFT for the owner (professional Flemish register, owner has final say), that domain nouns follow the app's existing Dutch catalogue — Sondering (CPT), Boring, Dwarsprofiel, geologie-as — rather than a second spelling, and that product names (StrixGeo, DOV, Plaxis, NAD, TAW, NAP) stay raw tokens.

.. CG-EXPLANATION-END id=module-header

``const TUTORIAL_NL``
---------------------

.. CG-BLOCK id=const:TUTORIAL_NL lines=12-191

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/tutorial.ts
   :language: typescript
   :lines: 12-191
   :lineno-match:

.. CG-EXPLANATION-START id=const:TUTORIAL_NL

**What this does.** The Dutch strings for the guided tour, key for key against English — the eight chapter titles, the coach-card buttons, and each step's ``.title`` and ``.body`` of two-to-four short sentences walking the engineer through one real control at a time, from naming the project to exporting. Values keep the same ``{current}`` / ``{total}`` slots as English.

**Why it is here.** The Dutch bodies describe only what the controls actually do and carry the same honesty about scope as the English — the geotech classes are CPT-derived characterisation estimates, not design values. Domain nouns reuse the app's canonical Dutch tokens rather than inventing a second spelling, keeping the tour consistent with the vocabulary the rest of the interface already shows.

.. CG-EXPLANATION-END id=const:TUTORIAL_NL

