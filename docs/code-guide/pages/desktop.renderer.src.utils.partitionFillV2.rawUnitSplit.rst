desktop.renderer.src.utils.partitionFillV2.rawUnitSplit
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/rawUnitSplit.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/rawUnitSplit.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-50

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/rawUnitSplit.ts
   :language: typescript
   :lines: 1-50
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module splits a MERGED host unit back into the raw picked sub-pieces it was welded from, so the termination sweep classifies each original piece on its own rather than the merged whole. The imports bring in the effective-correlation and tie-reference types and the unit and column geometry types.

**Why it is here.** Owner ruling 8r (2026-07-19, verbatim: "the middle clay should lens, i want the lines before the merge. (first fill then merge remember)"). The enclosed-lens extraction collapses a same-soil sandwich into one merged host before the sweep classifies it, so a boundary line gets drawn on the merged host — exactly what 8r forbids. This re-derives the raw pieces WITHOUT re-resolving ties, because ruling 8l(b) pins the tie inheritance structurally: a host-contact piece inherits that contact's tie, an interbed-cut contact is untied. The enclosed lens itself is drawn elsewhere, so it is not returned here — the sweep must not draw it twice.

.. CG-EXPLANATION-END id=module-header

``const SPLIT_EPS``
-------------------

.. CG-BLOCK id=const:SPLIT_EPS lines=51-58

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/rawUnitSplit.ts
   :language: typescript
   :lines: 51-58
   :lineno-match:

.. CG-EXPLANATION-START id=const:SPLIT_EPS

**What this does.** The elevation tolerance (1 mm) used when deciding where a lens interval falls inside a host.

**Why it is here.** It matches the 1 mm arrangement snap grid, so the split points agree with the grid every other part of the engine rounds to.

.. CG-EXPLANATION-END id=const:SPLIT_EPS

``interface RawSubPiece``
-------------------------

.. CG-BLOCK id=interface:RawSubPiece lines=59-79

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/rawUnitSplit.ts
   :language: typescript
   :lines: 59-79
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RawSubPiece

**What this does.** The shape of one raw sub-piece ready for the sweep: the piece as a unit, the merged host's index (for geometry reads that still index the merged stack), flags for whether it is the top or bottom piece, its inherited effective correlation, and its inherited direct top and base tie flags.

**Why it is here.** The sweep needs each raw piece's own contacts AND the tie state it inherits from the host per ruling 8l(b); the host index is carried because some later geometry reads still address the merged column stack, not the raw pieces.

.. CG-EXPLANATION-END id=interface:RawSubPiece

``function lensIntervalsInHost``
--------------------------------

.. CG-BLOCK id=function:lensIntervalsInHost lines=80-123

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/rawUnitSplit.ts
   :language: typescript
   :lines: 80-123
   :lineno-match:

.. CG-EXPLANATION-START id=function:lensIntervalsInHost

**What this does.** Returns the enclosed-lens intervals of a column that fall strictly inside a given host unit's elevation span, sorted from shallow to deep — the points at which the host must be cut.

**Why it is here.** A merged host spans one or more enclosed-lens intervals; these are the split lines. A host containing none is not a merged sandwich and is left whole.

.. CG-EXPLANATION-END id=function:lensIntervalsInHost

``function splitHostIntoRawPieces``
-----------------------------------

.. CG-BLOCK id=function:splitHostIntoRawPieces lines=124-189

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/rawUnitSplit.ts
   :language: typescript
   :lines: 124-189
   :lineno-match:

.. CG-EXPLANATION-START id=function:splitHostIntoRawPieces

**What this does.** Splits one host into its raw picked pieces. When the host contains no enclosed lens it returns a single piece that IS the host, correlation and flags unchanged. Otherwise it walks the host span top to base, carving out each lens interval, and for each surviving piece assigns the inherited tie state: the top piece keeps the host's top tie, the bottom piece keeps the host's base tie, every interbed-cut contact between is untied, and the literal correlation count follows from those flags.

**Why it is here.** Ruling 8l(b): host-contact pieces inherit that contact's ties; interbed-cut contacts are untied. Because the merged host keeps one of its enclosing units' identities, its own top and base ARE the raw top-piece's top and the raw bottom-piece's base — the same physical surfaces the ties resolved to — so the tie state can be inherited rather than re-resolved. The ordinary-unit no-op split guarantees a normal unit's emission stays byte-identical to the per-column sweep.

.. CG-EXPLANATION-END id=function:splitHostIntoRawPieces

