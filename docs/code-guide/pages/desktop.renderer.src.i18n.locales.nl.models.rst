desktop.renderer.src.i18n.locales.nl.models
===========================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/nl/models.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/nl/models.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/models.ts
   :language: typescript
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens ``MODELS_NL`` — the Dutch (Belgian) mirror of the English ``models`` catalogue, for the three model-building stages: geological, lithostratigraphic and geotechnical. It is the Dutch side.

**Why it is here.** The interface text lives in per-language catalogues so a component asks for a text by its key and gets the string for the active language, checked key-for-key against English by the ``localeParity`` test. It points to ``locales/nl/index.ts`` for the terminology rules — a professional Flemish register, with domain tokens never re-translated here.

.. CG-EXPLANATION-END id=module-header

``const MODELS_NL``
-------------------

.. CG-BLOCK id=const:MODELS_NL lines=5-661

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/models.ts
   :language: typescript
   :lines: 5-661
   :lineno-match:

.. CG-EXPLANATION-START id=const:MODELS_NL

**What this does.** The Dutch strings for the three model stages, key for key against English, in the same three blocks — geology (``geology.*``, opening with "Formaties" / "Formatie toevoegen"), lithology (``litho.*``) and geotech (``geotech.*``). Values keep the same ``{n}`` / ``{name}`` / ``{label}`` slots as English so counts and names drop into the reordered Dutch sentence.

**Why it is here.** The strings back the same owner rulings recorded on the English side (cone-derived packing is the unbadged norm; the geotech roster is soil then litho-body then packing-body; the admixture prompt names the admixture found). Soil names, lithology labels and NAD packing-class names are shown as their raw Dutch-canonical tokens from the domain sources, not translated a second time here — translation happens only at the presentation boundary.

.. CG-EXPLANATION-END id=const:MODELS_NL

