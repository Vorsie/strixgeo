desktop.renderer.src.utils.partitionFillV2.edgedEnclosedLens
============================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/edgedEnclosedLens.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/edgedEnclosedLens.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/edgedEnclosedLens.ts
   :language: typescript
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file handles the edged enclosed lens -- a minority soil wrapped by the same soil above and below on its own column that is TIED toward one neighbour (so it bands that way) but has ZERO ties toward the other (so it must lens that way), per ruling 8v, 0 ties is always a lens. The owner's example is the S22 lower sand: silt above and below, a top tie banding it to the right, no tie to the shallow left. It extracts that minority as an enclosed lens whose lens is drawn ONLY into the untied gap.

**Why it is here.** The docstring explains the ordinary enclosed-lens path skips it (the minority is tied section-wide, so it is never a lens anywhere) and the flood then absorbs its notch. The fix merges the enclosing matrix into one continuous band so the lens is a real interior hole, but records the lens as emitting only into the untied gaps so the tied gap keeps its band by construction. It is flag-gated and additive (a section with no edged-enclosed minority is byte-identical). Pure module.

.. CG-EXPLANATION-END id=module-header

``const TIE_CONTACT_SNAP_M``
----------------------------

.. CG-BLOCK id=const:TIE_CONTACT_SNAP_M lines=41-50

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/edgedEnclosedLens.ts
   :language: typescript
   :lines: 41-50
   :lineno-match:

.. CG-EXPLANATION-START id=const:TIE_CONTACT_SNAP_M

**What this does.** A tiny (one-millionth-metre) tolerance for matching a minority's contact to a tie-endpoint elevation.

**Why it is here.** Contacts are compared before the snap; the tolerance decides whether a contact rides a tie.

.. CG-EXPLANATION-END id=const:TIE_CONTACT_SNAP_M

``interface TieContactsByGap``
------------------------------

.. CG-BLOCK id=interface:TieContactsByGap lines=51-69

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/edgedEnclosedLens.ts
   :language: typescript
   :lines: 51-69
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TieContactsByGap

**What this does.** A type exposing, per surviving column and gap, the set of tie-endpoint contact elevations -- a minority whose top or base coincides with one is tied in that gap and must band there.

**Why it is here.** This is the per-gap shared-contact guard (ruling 8a made per-gap): it is built from the raw picked contacts (the elevations the owner drew, before any merge).

.. CG-EXPLANATION-END id=interface:TieContactsByGap

``function buildTieContactsByGap``
----------------------------------

.. CG-BLOCK id=function:buildTieContactsByGap lines=70-106

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/edgedEnclosedLens.ts
   :language: typescript
   :lines: 70-106
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildTieContactsByGap

**What this does.** Builds the per-column, per-gap set of tie-endpoint elevations from the approved edges over the raw picked contacts, counting only adjacent-column edges (a jump edge is a bridge, not a per-gap tie).

**Why it is here.** It gives the extraction a precise per-gap view of which contacts ride a tie, so a minority is judged tied only in the gap the tie actually resolves to.

.. CG-EXPLANATION-END id=function:buildTieContactsByGap

``const EMPTY``
---------------

.. CG-BLOCK id=const:EMPTY lines=107-128

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/edgedEnclosedLens.ts
   :language: typescript
   :lines: 107-128
   :lineno-match:

.. CG-EXPLANATION-START id=const:EMPTY

**What this does.** A shared empty set returned when a column-and-gap has no tie contacts.

**Why it is here.** Avoids allocating a fresh empty set on every miss.

.. CG-EXPLANATION-END id=const:EMPTY

``function extractPerGapEnclosedLenses``
----------------------------------------

.. CG-BLOCK id=function:extractPerGapEnclosedLenses lines=129-248

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/edgedEnclosedLens.ts
   :language: typescript
   :lines: 129-248
   :lineno-match:

.. CG-EXPLANATION-START id=function:extractPerGapEnclosedLenses

**What this does.** The core routine: for each column it finds a same-soil-enclosed minority that is untied toward at least one adjacent gap but tied toward another, and -- subject to four safety gates -- merges the enclosing matrix so the lens becomes a real interior hole, recording the lens as emitting only into the untied gaps. It grows the ``above`` unit down to the lens base and splices out only the lens, leaving ``below`` with its own ties.

**Why it is here.** The docstring and inline comments spell out the four safety gates that scope it to the isolated case the merge handles cleanly (design section 4 / ruling 8v): the untied emit gap must be above the facing TD (a sub-TD minority is the substrate's job -- extracting one there overpainted a drilled sand), the enclosing matrix must itself band in the emit gap (else an interbedded comb holes the tied-gap annulus), the minority must carry a same-soil tie in every tied gap (so that gap is a guaranteed band), and the kept ``below`` must not itself carry a same-soil tie (else the abutted run reads as one full-width band the conformance gate flags). The broader interbedded-comb class is deliberately excluded as the multi-increment restructuring the design marks stopped with geometry.

.. CG-EXPLANATION-END id=function:extractPerGapEnclosedLenses

``function buildSameFormationTieGaps``
--------------------------------------

.. CG-BLOCK id=function:buildSameFormationTieGaps lines=249-273

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/edgedEnclosedLens.ts
   :language: typescript
   :lines: 249-273
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildSameFormationTieGaps

**What this does.** Builds, per layer id, the set of gaps where that layer has a direct tie to a facing unit of its OWN soil.

**Why it is here.** The extraction's safety gates read this to tell a guaranteed same-soil band gap from a different-soil tie; it is built from the raw contacts (soil plus surviving column index).

.. CG-EXPLANATION-END id=function:buildSameFormationTieGaps

