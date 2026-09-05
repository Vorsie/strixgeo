desktop.renderer.src.utils.lensLabel
====================================

.. CG-PAGE source=desktop/src/renderer/src/utils/lensLabel.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/lensLabel.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lensLabel.ts
   :language: typescript
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The comment block that opens the file. It notes that only one display-label helper for bodies still lives here: the lithology abbreviation.

**Why it is here.** The comment records that the old depth-rank auto-labelling was removed together with the body-extent overlay it served, leaving just the abbreviation helper behind.

.. CG-EXPLANATION-END id=module-header

``const LITHOLOGY_ABBREV``
--------------------------

.. CG-BLOCK id=const:LITHOLOGY_ABBREV lines=11-22

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lensLabel.ts
   :language: typescript
   :lines: 11-22
   :lineno-match:

.. CG-EXPLANATION-START id=const:LITHOLOGY_ABBREV

**What this does.** A lookup table from a base-lithology token — the raw Dutch words GRIND, SILT, ZAND, KLEI, VEEN — to a one- or two-letter abbreviation.

**Why it is here.** The comment records the owner directive of 2026-06-01 fixing these abbreviations: Gravel to G, Silt to Si, Sand to Sa, Clay to C, Peat to P — the desktop translating the raw token for display.

.. CG-EXPLANATION-END id=const:LITHOLOGY_ABBREV

``function lithologyAbbrev``
----------------------------

.. CG-BLOCK id=function:lithologyAbbrev lines=23-29

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lensLabel.ts
   :language: typescript
   :lines: 23-29
   :lineno-match:

.. CG-EXPLANATION-START id=function:lithologyAbbrev

**What this does.** Given a lithology token, returns its abbreviation from the table; an unrecognised token falls back to its first two characters, title-cased, and an empty input returns an empty string.

**Why it is here.** The docstring records that the fall-back means even a non-core soil still yields a short, readable abbreviation instead of nothing.

.. CG-EXPLANATION-END id=function:lithologyAbbrev

