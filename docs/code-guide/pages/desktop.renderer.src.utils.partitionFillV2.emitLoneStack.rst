desktop.renderer.src.utils.partitionFillV2.emitLoneStack
========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/emitLoneStack.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/emitLoneStack.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLoneStack.ts
   :language: typescript
   :lines: 1-49
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module draws a lone multi-unit interbedded stack: several units on one column with no facing counterpart in the interval. The enclosing matrix bands full-width across to the facing matrix run, and each minority pinches at its own mid-elevation as a notch biting the lone column edge. To keep every notch a simple, non-crossing shape it slices the left strip into per-minority slabs with horizontal seams at each minority's top and base plus a vertical seam at the apex line, all sharing one apex fraction.

**Why it is here.** The docstring records the increment-15 wall it fixes: an earlier version flooded the matrix as a converging wedge, which traced a self-crossing comb. The increment-16 fix (mechanism b) makes the matrix band full-width and slices the notched strip so each minority closes into its own simple lens face and no matrix face absorbs an adjacent minority's edge.

.. CG-EXPLANATION-END id=module-header

``const ELEV_EPS``
------------------

.. CG-BLOCK id=const:ELEV_EPS lines=50-54

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLoneStack.ts
   :language: typescript
   :lines: 50-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:ELEV_EPS

**What this does.** The one-millionth-of-a-metre elevation slack, as elsewhere.

**Why it is here.** Floating-point noise must not read as a real elevation difference before the 1 mm snap.

.. CG-EXPLANATION-END id=const:ELEV_EPS

``function facingMatrixRunSpan``
--------------------------------

.. CG-BLOCK id=function:facingMatrixRunSpan lines=55-100

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLoneStack.ts
   :language: typescript
   :lines: 55-100
   :lineno-match:

.. CG-EXPLANATION-START id=function:facingMatrixRunSpan

**What this does.** Returns the top-to-base elevation span of the facing column's run of the enclosing matrix soil where it overlaps the lone stack, or nothing when the facing carries no such run overlapping it.

**Why it is here.** The docstring notes that when the facing carries no matrix run to band full-width to, the stack cannot band and the caller must fall back; this measures whether such a run exists and how far it spans.

.. CG-EXPLANATION-END id=function:facingMatrixRunSpan

``function emitLoneStackBand``
------------------------------

.. CG-BLOCK id=function:emitLoneStackBand lines=101-133

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLoneStack.ts
   :language: typescript
   :lines: 101-133
   :lineno-match:

.. CG-EXPLANATION-START id=function:emitLoneStackBand

**What this does.** Draws the slab-seam decomposition: a horizontal seam at every minority's top and base, from the lone column edge to the notch apex line, all coloured with the matrix soil. Together with the minority lens closings at the same apex fraction they slice the notched strip into per-minority slabs.

**Why it is here.** The docstring explains the seams stop at the apex line rather than the facing column because a full-width seam would cross the interval's converging brackets (measured on gap18), and the matrix beyond the apex stays one clean face carrying no minority edge, coloured from the matrix label by the finding-A trick.

.. CG-EXPLANATION-END id=function:emitLoneStackBand

``const MIN_CLAMPED_FRACTION``
------------------------------

.. CG-BLOCK id=const:MIN_CLAMPED_FRACTION lines=134-142

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLoneStack.ts
   :language: typescript
   :lines: 134-142
   :lineno-match:

.. CG-EXPLANATION-START id=const:MIN_CLAMPED_FRACTION

**What this does.** A constant, 0.3: below this apex fraction a minority is treated as a boundary unit lapping the bracket rather than a heavily-truncated lens, and the lone-stack path bows out to the full-width fallback.

**Why it is here.** The comment records v1 shapes such a boundary-adjacent minority as an onlap, not a near-zero-apex lens, so the path declines rather than emit a divergent shape (B4|S13 gap3's top silt).

.. CG-EXPLANATION-END id=const:MIN_CLAMPED_FRACTION

``function clampedLensFraction``
--------------------------------

.. CG-BLOCK id=function:clampedLensFraction lines=143-186

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLoneStack.ts
   :language: typescript
   :lines: 143-186
   :lineno-match:

.. CG-EXPLANATION-START id=function:clampedLensFraction

**What this does.** Computes a minority lens's apex fraction, reduced so its apex stays on the matrix side of both the band's top and base edge near a boundary; it steps the fraction down until the apex mid-elevation sits inside the sloping band edges.

**Why it is here.** The docstring notes a minority near a band edge would pinch past a band boundary at the full fraction, so it is shortened, matching v1 which also shortens such a boundary-adjacent lens.

.. CG-EXPLANATION-END id=function:clampedLensFraction

``function routeLoneStack``
---------------------------

.. CG-BLOCK id=function:routeLoneStack lines=187-323

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/emitLoneStack.ts
   :language: typescript
   :lines: 187-323
   :lineno-match:

.. CG-EXPLANATION-START id=function:routeLoneStack

**What this does.** Routes and draws a lone multi-unit interbedded stack, returning true when handled. It picks the enclosing matrix soil (with a surgical correction when the normal sample lands on a zero-thickness facing contact), tries a converging-stack fallback when the facing bracket pinches to a point, reduces the stack to matrix plus minorities, confirms the facing carries a continuous matrix run, computes each minority's clamped and reach-capped apex fraction, draws the slab seams, and draws each minority's lens.

**Why it is here.** The docstring records the surgical enclosing-matrix correction (Tie-6 gap0: the normal sample on a zero-thickness contact returned ZAND, not the enclosing KLEI, so the stack could not reduce and SILT flooded full-width, a ruling-8 violation), fired only on that mis-sample signature so the ~32 already-correct cases stay byte-identical. It also records the converging-stack fallback for CS1 col18 SILT/VEEN (ruling 8h phases 1-2, each 0-corr minority gets its own lens with the own-bracket enclosing flooding around them) and the MIN_CLAMPED_FRACTION bow-out for a boundary minority in a narrow band.

.. CG-EXPLANATION-END id=function:routeLoneStack

