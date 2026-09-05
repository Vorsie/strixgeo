desktop.renderer.src.utils.lithoLabelsNl
========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/lithoLabelsNl.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/lithoLabelsNl.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabelsNl.ts
   :language: typescript
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The comment block that opens the file. It holds the Dutch (Flemish) admixture display vocabulary for lithostratigraphic units.

**Why it is here.** The comment records two reasons it is split out of the main labels file: to stay under the 500-line ceiling (debt #201), and to keep the Dutch words in one reviewable place — because unlike the base soil word, which is the domain's own source token, these admixture adjectives and scale words are a presentation-boundary CHOICE, not a stored lookup. The comment carries an owner FLAG to confirm the words against borehole-log vernacular, notes that the DOV five-step amount codes are rendered on the NEN zwak/matig/sterk scale as a best attempt, and that only the core codes a Belgian/Dutch log carries are curated — an uncurated code falls back to the English adjective.

.. CG-EXPLANATION-END id=module-header

``const ADMIXTURE_SOIL_NL``
---------------------------

.. CG-BLOCK id=const:ADMIXTURE_SOIL_NL lines=16-63

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabelsNl.ts
   :language: typescript
   :lines: 16-63
   :lineno-match:

.. CG-EXPLANATION-START id=const:ADMIXTURE_SOIL_NL

**What this does.** A lookup table from an admixture soil code to its Dutch adjective ("kleiig") or, for coarse inclusions, a "met X" noun phrase ("met schelpen"). It covers the core five soils, DOV aliases and grain-size variants, organics, and carbonate/shell inclusions.

**Why it is here.** The comment records that these Dutch words are the presentation-layer choice for the codes a Belgian/Dutch borehole log carries in practice.

.. CG-EXPLANATION-END id=const:ADMIXTURE_SOIL_NL

``const ADMIXTURE_AMOUNT_NL``
-----------------------------

.. CG-BLOCK id=const:ADMIXTURE_AMOUNT_NL lines=64-75

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabelsNl.ts
   :language: typescript
   :lines: 64-75
   :lineno-match:

.. CG-EXPLANATION-START id=const:ADMIXTURE_AMOUNT_NL

**What this does.** A lookup table from an amount code to the Dutch adverb placed before an adjective admixture ("matig kleiig").

**Why it is here.** The comment carries an owner FLAG to verify the Flemish scale word per DOV code: the norm axis is zwak / matig / sterk, but the DOV codes are a five-step Z/W/M/V/S, mapped here as a best attempt.

.. CG-EXPLANATION-END id=const:ADMIXTURE_AMOUNT_NL

``const ADMIXTURE_AMOUNT_QUANTITY_NL``
--------------------------------------

.. CG-BLOCK id=const:ADMIXTURE_AMOUNT_QUANTITY_NL lines=76-85

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLabelsNl.ts
   :language: typescript
   :lines: 76-85
   :lineno-match:

.. CG-EXPLANATION-START id=const:ADMIXTURE_AMOUNT_QUANTITY_NL

**What this does.** A lookup table from an amount code to the Dutch quantity word for a noun-phrase admixture ("weinig schelpgruis").

**Why it is here.** The comment carries the same owner FLAG; a separate table exists because a "met X" noun phrase needs a quantity word in front of the noun rather than the adverb used before an adjective.

.. CG-EXPLANATION-END id=const:ADMIXTURE_AMOUNT_QUANTITY_NL

