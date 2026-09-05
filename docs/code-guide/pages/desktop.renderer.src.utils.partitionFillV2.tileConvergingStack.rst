desktop.renderer.src.utils.partitionFillV2.tileConvergingStack
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/tileConvergingStack.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/tileConvergingStack.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tileConvergingStack.ts
   :language: typescript
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module is the tiler for a MULTI-UNIT present side facing a column that CONVERGES to a point. It draws every 0-correlation minority as its own lens biting its column edge, separates adjacent units with horizontal boundary seams, and floods the space past the apexes to the convergence point with the enclosing soil. The imports bring in the lens-closing emitter, the label and matrix-lookup helpers, the reach-fitter, the column geometry, the degeneracy guard, and the curve types.

**Why it is here.** Extracted from the coherent-stack module for the 500-line budget (debt #201). Ruling 8h phases 1-2: EVERY 0-corr unit-side always gets its lens, unconditionally, even in a multi-unit stack. The single-unit branch handled its case hole-free but bailed on a multi-unit present side (independent wedges overlapped, measured +457 holes / +666 overlaps), so this supplies the missing coherent construction — the slab-seam trick generalised to a converging facing. Pure module.

.. CG-EXPLANATION-END id=module-header

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=32-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tileConvergingStack.ts
   :language: typescript
   :lines: 32-34
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** A small metres tolerance for elevation comparisons before the 1 mm snap.

**Why it is here.** Bracket-adjacency and overlap tests need a tiny slack so float noise near a contact does not flip them.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``const BRACKET_EPS``
---------------------

.. CG-BLOCK id=const:BRACKET_EPS lines=35-50

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tileConvergingStack.ts
   :language: typescript
   :lines: 35-50
   :lineno-match:

.. CG-EXPLANATION-START id=const:BRACKET_EPS

**What this does.** The bracket-match tolerance in metres — a contact within this of the interval boundary counts as adjacent.

**Why it is here.** The enclosing lithology is found by matching a neighbouring unit's contact to the interval boundary; this is how close counts as touching.

.. CG-EXPLANATION-END id=const:BRACKET_EPS

``const MULTI_UNIT_CONVERGING_ENABLED``
---------------------------------------

.. CG-BLOCK id=const:MULTI_UNIT_CONVERGING_ENABLED lines=51-53

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tileConvergingStack.ts
   :language: typescript
   :lines: 51-53
   :lineno-match:

.. CG-EXPLANATION-START id=const:MULTI_UNIT_CONVERGING_ENABLED

**What this does.** A constant, set true, that turns this coherent multi-unit construction on.

**Why it is here.** The docstring records the history (session-11 ruling 8b conflict-resolution): an earlier FLAT construction measured +22 holes / +81 overlaps, so the owner's ruled mechanism was adopted — the seams never move, the LENS shrinks ("you can just shorten the lenses by half if there is conflict with a tie"). Now each minority is a halved lens fitted inside the sloping wedge and the flood corners ride the sloping bracket, so no sliver survives. It is flipped on because the halving loop passed the battery; the docstring keeps the stop-and-report escape if real data ever regresses.

.. CG-EXPLANATION-END id=const:MULTI_UNIT_CONVERGING_ENABLED

``const CONV_STACK_DIAG``
-------------------------

.. CG-BLOCK id=const:CONV_STACK_DIAG lines=54-54

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tileConvergingStack.ts
   :language: typescript
   :lines: 54-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONV_STACK_DIAG

**What this does.** A throwaway diagnostics record counting how often the tiler fires versus bails, for each reason.

**Why it is here.** A session-10 development counter the orchestrator strips; it makes the fire and bail paths visible while the construction is being measured.

.. CG-EXPLANATION-END id=const:CONV_STACK_DIAG

``function cbump``
------------------

.. CG-BLOCK id=function:cbump lines=55-57

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tileConvergingStack.ts
   :language: typescript
   :lines: 55-57
   :lineno-match:

.. CG-EXPLANATION-START id=function:cbump

**What this does.** Increments one named counter in the diagnostics record.

**Why it is here.** A one-line helper so each fire and bail site records its reason without repeating the increment.

.. CG-EXPLANATION-END id=function:cbump

``function convStackDiagReset``
-------------------------------

.. CG-BLOCK id=function:convStackDiagReset lines=58-67

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tileConvergingStack.ts
   :language: typescript
   :lines: 58-67
   :lineno-match:

.. CG-EXPLANATION-START id=function:convStackDiagReset

**What this does.** Clears the diagnostics record.

**Why it is here.** A test or a fresh section starts the counters from zero.

.. CG-EXPLANATION-END id=function:convStackDiagReset

``function ownColumnBracket``
-----------------------------

.. CG-BLOCK id=function:ownColumnBracket lines=68-82

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tileConvergingStack.ts
   :language: typescript
   :lines: 68-82
   :lineno-match:

.. CG-EXPLANATION-START id=function:ownColumnBracket

**What this does.** Returns the present column's enclosing soil immediately above or below an interval boundary — the neighbouring unit whose contact meets that elevation — or nothing when no such unit exists.

**Why it is here.** The docstring pins this as the lateral enclosing at the convergence (v1's above-litho / below-litho). It is read from the PRESENT column, not a facing sample, because a converging facing has near-zero interval thickness and sampling it would return the facing's own boundary soil and mis-label the matrix. A missing bracket (surface or TD) means no enclosing, and the caller bails.

.. CG-EXPLANATION-END id=function:ownColumnBracket

``function facingCarriesFormation``
-----------------------------------

.. CG-BLOCK id=function:facingCarriesFormation lines=83-130

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tileConvergingStack.ts
   :language: typescript
   :lines: 83-130
   :lineno-match:

.. CG-EXPLANATION-START id=function:facingCarriesFormation

**What this does.** Returns whether the facing column carries a given soil overlapping an elevation span.

**Why it is here.** A would-be minority the facing actually HAS is a matched matrix that should band, not a genuine interbed the facing lacks — so this keeps the converging-stack tiler off a main matrix unit.

.. CG-EXPLANATION-END id=function:facingCarriesFormation

``function emitConvergingStack``
--------------------------------

.. CG-BLOCK id=function:emitConvergingStack lines=131-330

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tileConvergingStack.ts
   :language: typescript
   :lines: 131-330
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitConvergingStack

**What this does.** Emits the whole multi-unit converging construction. It reads the enclosing soil above and below the stack from the present column's own brackets, works out which units are genuine minorities (soil differing from both enclosing soils) and which are matrix, and bails when there is no enclosing bracket, no minority, an ambiguous or interleaved matrix, or a facing that carries a minority or forms a true same-soil annulus. Then it draws each minority as a halved lens fitted inside the sloping wedge, adds horizontal boundary seams labelled with the enclosing matrix, draws the apex-line vertical whose ends ride the sloping brackets, and floods the residue to the convergence point (one soil when the enclosing is the same above and below, split at the interval mid otherwise).

**Why it is here.** It is the slab-seam construction proven hole-free, generalised to a converging facing. The docstring pins the details to rulings: every 0-corr minority always lenses (8h), the seams never move while the lens shrinks (8b conflict-resolution), the flood corners ride the sloping bracket to kill the session-10 sliver, and it is all-or-nothing per ruling 7 (the caller commits only on success). The many bail reasons each guard a shape the coherent flood cannot close hole-free — most sharply the same-soil-on-both-columns annulus (the splitAnnulus-bypass wall) and the interleaved matrix — and the mixed-enclosing split uses the no-auto-facies midpoint seam.

.. CG-EXPLANATION-END id=function:emitConvergingStack

