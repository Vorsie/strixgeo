desktop.renderer.src.utils.partitionFillV2.separationConstraint
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/separationConstraint.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/separationConstraint.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/separationConstraint.ts
   :language: typescript
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module implements the user's ``Separate`` ruling as a cannot-link woven into the body weld's union-find. It tracks, per union-find group, which side (A or B) of each separation the group holds, and reports when a proposed join would put both sides under one group — which the caller must then skip.

**Why it is here.** Owner ruling 2026-08-31 (debt #278 R5): ``Separate`` is a durable statement that two masses are NOT one body. The resolver honours it, but the 2-D fill still welds same-class touching masses, so after a split the paint would stay one mass and the seam the engineer drew would be invisible. This mirrors the backend's constrained union-find at the region-merge scale. Pure and deterministic — the incidence merge is a set union, so it is order-independent.

.. CG-EXPLANATION-END id=module-header

``function canonicalSeparationPair``
------------------------------------

.. CG-BLOCK id=function:canonicalSeparationPair lines=31-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/separationConstraint.ts
   :language: typescript
   :lines: 31-49
   :lineno-match:

.. CG-EXPLANATION-START id=function:canonicalSeparationPair

**What this does.** Builds the canonical key for one separation — the two layer anchors joined with the lexicographically smaller one first.

**Why it is here.** So the two engines and the backend all agree on ONE string per pair regardless of the order the anchors were stored in.

.. CG-EXPLANATION-END id=function:canonicalSeparationPair

``function toSeparatedPairs``
-----------------------------

.. CG-BLOCK id=function:toSeparatedPairs lines=50-58

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/separationConstraint.ts
   :language: typescript
   :lines: 50-58
   :lineno-match:

.. CG-EXPLANATION-START id=function:toSeparatedPairs

**What this does.** Builds the deduplicated set of canonical pairs a weld engine consumes from the model's stored separations, each carrying its two layer-id anchors.

**Why it is here.** The input is kept structural (rows shaped with two anchor fields) so this module stays free of the API types — the caller passes plain rows.

.. CG-EXPLANATION-END id=function:toSeparatedPairs

``type Side``
-------------

.. CG-BLOCK id=type:Side lines=59-61

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/separationConstraint.ts
   :language: typescript
   :lines: 59-61
   :lineno-match:

.. CG-EXPLANATION-START id=type:Side

**What this does.** A type naming which anchor of a separation a group contains — A or B.

**Why it is here.** A group must remember which end of a split it holds so the completion test can tell when a join would unite both ends.

.. CG-EXPLANATION-END id=type:Side

``type SeparationIncidence``
----------------------------

.. CG-BLOCK id=type:SeparationIncidence lines=62-93

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/separationConstraint.ts
   :language: typescript
   :lines: 62-93
   :lineno-match:

.. CG-EXPLANATION-START id=type:SeparationIncidence

**What this does.** The record type mapping each union-find root to, per separation, the set of sides present under that root.

**Why it is here.** This is the per-group memory the completion test reads and the absorb step updates as groups merge.

.. CG-EXPLANATION-END id=type:SeparationIncidence

``function seedSeparationIncidence``
------------------------------------

.. CG-BLOCK id=function:seedSeparationIncidence lines=94-156

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/separationConstraint.ts
   :language: typescript
   :lines: 94-156
   :lineno-match:

.. CG-EXPLANATION-START id=function:seedSeparationIncidence

**What this does.** Parses the canonical pairs and seeds each participating node's incidence: a node is seeded for a pair only when its layer ids contain at least one anchor, marking side A or B accordingly. It returns the incidence and the pair count.

**Why it is here.** It is written node-shaped, not region-shaped, so both weld engines share it — the litho merge's nodes are regions, the geotech merge's are packing-band faces. When no separations are passed it returns an empty incidence and a zero pair count, so the caller can skip every constraint check and the weld stays byte-identical to the unconstrained merge.

.. CG-EXPLANATION-END id=function:seedSeparationIncidence

``function unionCompletesSeparation``
-------------------------------------

.. CG-BLOCK id=function:unionCompletesSeparation lines=157-192

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/separationConstraint.ts
   :language: typescript
   :lines: 157-192
   :lineno-match:

.. CG-EXPLANATION-START id=function:unionCompletesSeparation

**What this does.** Returns whether merging two roots would place both sides of some separation under one root, by scanning only the separation indices present on BOTH roots.

**Why it is here.** It mirrors the backend's completion test exactly: only indices on both roots can be newly completed by the merge, so a root that already carries both sides of a pair (an already-welded region) does not block an unrelated join. The smaller map is iterated for speed.

.. CG-EXPLANATION-END id=function:unionCompletesSeparation

``function absorbSeparationIncidence``
--------------------------------------

.. CG-BLOCK id=function:absorbSeparationIncidence lines=193-214

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/separationConstraint.ts
   :language: typescript
   :lines: 193-214
   :lineno-match:

.. CG-EXPLANATION-START id=function:absorbSeparationIncidence

**What this does.** After an allowed join, folds one root's incidence into the surviving root as a per-index set union, then drops the absorbed root.

**Why it is here.** The merge is order-independent, so it does not matter which root the caller keeps; it is called only after the completion test has already permitted the join.

.. CG-EXPLANATION-END id=function:absorbSeparationIncidence

