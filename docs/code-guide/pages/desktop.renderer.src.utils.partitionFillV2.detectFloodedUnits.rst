desktop.renderer.src.utils.partitionFillV2.detectFloodedUnits
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/detectFloodedUnits.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/detectFloodedUnits.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detectFloodedUnits.ts
   :language: typescript
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is the detection half of the safe-default repair. After one fill pass, a drilled unit's own column edge must show the unit's OWN soil (the column is ground truth). This pass scans the finished tiles and flags every unit whose near-column band is painted a DIFFERENT soil -- the data-loss case where a suppressed onlap let an enclosing flood paint over a drilled clay as silt. The flagged units drive the repair re-run (they are forced to a lens) and double as the review-flag data.

**Why it is here.** The docstring records the owner rulings behind it (2026-07-26 find the gaps and re-emit; 2026-09-04 zero ties = lens, so the flooded unit is redrawn as a lens, never an onlap). It checks only units ABOVE the shallow TD, because the sub-TD zone is the deep-to-deep substrate's job and a foreign paint there is a different mechanism. Pure module.

.. CG-EXPLANATION-END id=module-header

``const EDGE_FRAC``
-------------------

.. CG-BLOCK id=const:EDGE_FRAC lines=23-23

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detectFloodedUnits.ts
   :language: typescript
   :lines: 23-23
   :lineno-match:

.. CG-EXPLANATION-START id=const:EDGE_FRAC

**What this does.** How far inside a column edge to sample (0.02) -- just inside, so the drilled column vertical owns it.

**Why it is here.** Sampling a hair inside the edge reads the unit's own near-column band, not the neighbour's.

.. CG-EXPLANATION-END id=const:EDGE_FRAC

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=24-25

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detectFloodedUnits.ts
   :language: typescript
   :lines: 24-25
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** A tiny elevation tolerance (one-millionth metre).

**Why it is here.** Standard hair's-width margin for the sub-TD skip comparison.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``const SAMPLE_FRACTIONS``
--------------------------

.. CG-BLOCK id=const:SAMPLE_FRACTIONS lines=26-28

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detectFloodedUnits.ts
   :language: typescript
   :lines: 26-28
   :lineno-match:

.. CG-EXPLANATION-START id=const:SAMPLE_FRACTIONS

**What this does.** Three band-interior sample heights (30, 50 and 70 per cent of the unit's thickness).

**Why it is here.** The comment notes these avoid the exact top and base contacts where the neighbour unit begins, so a sample reads the unit's own interior.

.. CG-EXPLANATION-END id=const:SAMPLE_FRACTIONS

``function pointInPoly``
------------------------

.. CG-BLOCK id=function:pointInPoly lines=29-39

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detectFloodedUnits.ts
   :language: typescript
   :lines: 29-39
   :lineno-match:

.. CG-EXPLANATION-START id=function:pointInPoly

**What this does.** A ray-cast test for whether a point (a fraction and an elevation) lies inside a polygon.

**Why it is here.** The primitive that asks which tile covers a sample point.

.. CG-EXPLANATION-END id=function:pointInPoly

``function coverFormationAt``
-----------------------------

.. CG-BLOCK id=function:coverFormationAt lines=40-45

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detectFloodedUnits.ts
   :language: typescript
   :lines: 40-45
   :lineno-match:

.. CG-EXPLANATION-START id=function:coverFormationAt

**What this does.** Returns the soil covering a given fraction-and-elevation in a gap's tiles, or nothing when no tile covers it.

**Why it is here.** It is how the check reads what was actually painted at a sample point.

.. CG-EXPLANATION-END id=function:coverFormationAt

``function checkColumn``
------------------------

.. CG-BLOCK id=function:checkColumn lines=46-97

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detectFloodedUnits.ts
   :language: typescript
   :lines: 46-97
   :lineno-match:

.. CG-EXPLANATION-START id=function:checkColumn

**What this does.** Checks one column's units terminating into a gap: for each above-TD unit it samples three interior heights at the near-column fraction, and flags the unit only when EVERY covered sample is a foreign soil.

**Why it is here.** The comment explains requiring all samples foreign avoids a false positive where a face merely thins near a contact and shows a sliver of the neighbour; a hole sample (nothing covering) is skipped as the holes gate's concern.

.. CG-EXPLANATION-END id=function:checkColumn

``function detectFloodedUnits``
-------------------------------

.. CG-BLOCK id=function:detectFloodedUnits lines=98-120

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/detectFloodedUnits.ts
   :language: typescript
   :lines: 98-120
   :lineno-match:

.. CG-EXPLANATION-START id=function:detectFloodedUnits

**What this does.** The public pass: it groups the tiles by gap, works out each gap's shallow TD, and checks both facing columns' units, returning the set of force-lens keys for the flooded units -- empty when the fill lost no drilled soil.

**Why it is here.** An empty result means the clean case (no repair re-run needed), which keeps clean sections byte-identical to the pre-repair engine.

.. CG-EXPLANATION-END id=function:detectFloodedUnits

