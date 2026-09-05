desktop.renderer.src.utils.nadClassesNl
=======================================

.. CG-PAGE source=desktop/src/renderer/src/utils/nadClassesNl.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/nadClassesNl.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClassesNl.ts
   :language: typescript
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment. This file holds the Dutch (Flemish) labels for the NAD packing classes 1 to 31 — the Dutch forms of the English tables in the sibling ``nadClasses`` file. NAD packing class is a characterisation output, not a design value.

**Why it is here.** The comment records that it is split out to stay under the 500-line ceiling (debt #201) and to keep the Dutch vocabulary in one reviewable place, and that the full names are the engine's own canonical Dutch strings taken verbatim from its packing-class table — so rendering Dutch is selecting the source token, not inventing one (the published source is the Belgian national annex, NBN EN 1997-1 ANB Tabel 2.1). It records the owner's wording rulings of 2026-08-28 ("gp" expands to "gepakt"; the cohesive ladder is weinig / matig / vrij vast) and why the granular ladder keeps "dicht gepakt" versus "zeer dicht gepakt" — the owner's single word for both would make the two classes indistinguishable, and the source table separates them. An owner FLAG records that the compact abbreviations translate only the soil prefix and leave the packing codes and admixture markers in their English short form.

.. CG-EXPLANATION-END id=module-header

``const NAD_CLASS_NAMES_NL``
----------------------------

.. CG-BLOCK id=const:NAD_CLASS_NAMES_NL lines=34-74

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClassesNl.ts
   :language: typescript
   :lines: 34-74
   :lineno-match:

.. CG-EXPLANATION-START id=const:NAD_CLASS_NAMES_NL

**What this does.** Maps each NAD class number (1 to 31) to its full canonical Dutch packing-class label.

**Why it is here.** The docstring records that the labels are verbatim from the engine's packing-class source tokens, and that splitting each at the first comma-space yields the soil word — matching how the English table is split, so the same soil-family and packing helpers work on it unchanged.

.. CG-EXPLANATION-END id=const:NAD_CLASS_NAMES_NL

``const NAD_CLASS_ABBR_NL``
---------------------------

.. CG-BLOCK id=const:NAD_CLASS_ABBR_NL lines=75-109

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClassesNl.ts
   :language: typescript
   :lines: 75-109
   :lineno-match:

.. CG-EXPLANATION-START id=const:NAD_CLASS_ABBR_NL

**What this does.** Maps each NAD class number (1 to 31) to a compact ``{SOIL}·{packing}`` label with the Dutch soil word.

**Why it is here.** The docstring records that it parallels the English compact table: only the leading soil word is translated to the Dutch source token, while the packing codes stay in the same short form the English abbreviation uses (per the FLAG in the header).

.. CG-EXPLANATION-END id=const:NAD_CLASS_ABBR_NL

``const UNCLASSIFIED_QUALIFIER_NL``
-----------------------------------

.. CG-BLOCK id=const:UNCLASSIFIED_QUALIFIER_NL lines=110-110

.. literalinclude:: ../../../desktop/src/renderer/src/utils/nadClassesNl.ts
   :language: typescript
   :lines: 110-110
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNCLASSIFIED_QUALIFIER_NL

**What this does.** The Dutch wording a unit with no packing class shows: ``nog niet ingedeeld``.

**Why it is here.** It is the Dutch form of the English "not yet classified" qualifier.

.. CG-EXPLANATION-END id=const:UNCLASSIFIED_QUALIFIER_NL

