desktop.renderer.src.i18n.locales.nl.outputs
============================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/locales/nl/outputs.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/locales/nl/outputs.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/outputs.ts
   :language: typescript
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and opens ``OUTPUTS_NL`` — the Dutch (Belgian) mirror of the English ``outputs`` catalogue, for the two stages that read the model rather than build it: Parameters and Export. It is the Dutch side.

**Why it is here.** The interface text lives in per-language catalogues so a component asks for a text by its key and gets the string for the active language, checked key-for-key against English by the ``localeParity`` test. It points to ``locales/nl/index.ts`` for the terminology rules.

.. CG-EXPLANATION-END id=module-header

``const OUTPUTS_NL``
--------------------

.. CG-BLOCK id=const:OUTPUTS_NL lines=6-310

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/locales/nl/outputs.ts
   :language: typescript
   :lines: 6-310
   :lineno-match:

.. CG-EXPLANATION-START id=const:OUTPUTS_NL

**What this does.** The Dutch strings for the Parameters and Export stages, key for key against English — the parameter views ("Per proef", "Parameterweergaven"), the water-table editor, the per-unit distribution plots, the fence cutout, the NAD characteristic-values block, the methods table, and the export verbs (DXF, Plaxis, D-Stability, D-Sheet, PDF). Values keep the same ``{n}`` / ``{name}`` / ``{error}`` slots as English.

**Why it is here.** The Dutch copy carries the same scope boundary as the English: characterisation values only, with design-ready parameters marked as Phase 5. The published method references (Robertson, Mayne, Kulhawy & Mayne, Uzielli, the NAD table) are product/citation tokens and stay as they are; soil and NAD names are shown as recorded, translated only at the presentation boundary.

.. CG-EXPLANATION-END id=const:OUTPUTS_NL

