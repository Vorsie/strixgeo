desktop.renderer.src.utils.lithoConstants
=========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/lithoConstants.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/lithoConstants.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoConstants.ts
   :language: typescript
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The comment block that opens the file. It introduces the shared tables that turn a base-lithology token into a display label and a fill colour.

**Why it is here.** The comment records that the ghost-suggestion overlay draws a layer using these label and colour tables BEFORE any formation row exists; when the suggestion is accepted the engine stamps the formation's stored colour from the same lithology (debt #145), so accepted bands then read the formation's own colour and never drift from their preview. It also records a hard rule: the colour table must stay byte-identical to its mirror in the engine's ``litho_constants.py`` — the two together are one colour spec — and the keys are the base-lithology tokens the Robertson segmenter emits.

.. CG-EXPLANATION-END id=module-header

``const LITHOLOGY_COLORS``
--------------------------

.. CG-BLOCK id=const:LITHOLOGY_COLORS lines=17-24

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoConstants.ts
   :language: typescript
   :lines: 17-24
   :lineno-match:

.. CG-EXPLANATION-START id=const:LITHOLOGY_COLORS

**What this does.** Maps each base-lithology token to a fixed fill colour written as a hex code — amber for gravel, yellow for sand, lime-green for silt, blue-grey for clay, dark brown for peat.

**Why it is here.** The comment records that this table must match the engine's copy byte for byte, so a ghost preview and the accepted band can never disagree on colour; the values are hex literals because they feed the SVG fill attribute and the formation colour column directly, not Tailwind style tokens.

.. CG-EXPLANATION-END id=const:LITHOLOGY_COLORS

``const LITHOLOGY_LABELS``
--------------------------

.. CG-BLOCK id=const:LITHOLOGY_LABELS lines=25-38

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoConstants.ts
   :language: typescript
   :lines: 25-38
   :lineno-match:

.. CG-EXPLANATION-START id=const:LITHOLOGY_LABELS

**What this does.** Maps each base-lithology token to its English display label — Gravel, Sand, Silt, Clay, Peat.

**Why it is here.** This is the English half of the display lookup — the desktop translating the raw stored token into readable text at the presentation boundary.

.. CG-EXPLANATION-END id=const:LITHOLOGY_LABELS

``const LITHOLOGY_LABELS_NL``
-----------------------------

.. CG-BLOCK id=const:LITHOLOGY_LABELS_NL lines=39-52

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoConstants.ts
   :language: typescript
   :lines: 39-52
   :lineno-match:

.. CG-EXPLANATION-START id=const:LITHOLOGY_LABELS_NL

**What this does.** Maps each base-lithology token to its Dutch label, which is simply the title-cased source word (Grind, Zand, Silt, Klei, Veen).

**Why it is here.** The comment records that the five base lithologies ARE Dutch words in the domain, so rendering Dutch means selecting the source token rather than inventing a translation; the table is keyed identically to the English one so a display helper can pick the table by language and get the same five keys.

.. CG-EXPLANATION-END id=const:LITHOLOGY_LABELS_NL

``const LITHOLOGY_FALLBACK_COLOR``
----------------------------------

.. CG-BLOCK id=const:LITHOLOGY_FALLBACK_COLOR lines=53-53

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoConstants.ts
   :language: typescript
   :lines: 53-53
   :lineno-match:

.. CG-EXPLANATION-START id=const:LITHOLOGY_FALLBACK_COLOR

**What this does.** A single neutral-grey colour used for a lithology token that is not in the table.

**Why it is here.** The comment records that it matches the neutral grey used when a formation is first created, and that it is still needed by the ghost overlay, which must colour a layer before any formation row exists; once a suggestion is accepted, read-side surfaces use the formation's own stored colour instead (debt #145).

.. CG-EXPLANATION-END id=const:LITHOLOGY_FALLBACK_COLOR

