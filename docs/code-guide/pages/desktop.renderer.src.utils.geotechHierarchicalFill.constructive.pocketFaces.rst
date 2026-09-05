desktop.renderer.src.utils.geotechHierarchicalFill.constructive.pocketFaces
===========================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/pocketFaces.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/pocketFaces.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-60

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/pocketFaces.ts
   :language: typescript
   :lines: 1-60
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module re-owns "islands" — a patch of one packing mass that floats in the middle of a gap, touching neither test column, completely surrounded by a single other mass. It groups the fill's faces into connected patches of the same mass (using connected-components, a way of grouping things that are linked directly or through a chain), works out which patches reach a column and which do not, and gives any fully enclosed floating patch to the mass that encloses it. It imports the connected-component and edge helpers and the face-point shape.

**Why it is here.** Owner dogfeed 2026-08-25, Cross-section 3 gap 7: "that weird lens quad has no provenance, it isn't in the litho, it isn't in the geotech model" and "fill merge should have filled that and merged that weird constructor line?". His shape was a construct's leftover — a band carried across a blind column pinched toward the test that reads its ground, the litho cover crossed that pinch, and a triangle of medium-dense sand was left floating inside a dense body, reachable from nothing. The rule, in his words: a face may never be an island detached from its winning band's own ground. It deliberately never touches a mass that reaches a column, never invents an owner where two or more masses surround a patch, and never absorbs into ground that is itself adrift.

.. CG-EXPLANATION-END id=module-header

``const COLUMN_EPS``
--------------------

.. CG-BLOCK id=const:COLUMN_EPS lines=61-63

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/pocketFaces.ts
   :language: typescript
   :lines: 61-63
   :lineno-match:

.. CG-EXPLANATION-START id=const:COLUMN_EPS

**What this does.** A constant: how close to a gap's edge a point must be, in fraction, to count as touching that test column — half the arrangement's own snap step.

**Why it is here.** The engine identifies boundaries on a one-part-in-a-thousand grid, so two points nearer than this are one point as far as any traced loop is concerned, and the cover's rings and the faces cut from them agree only to about that. The docstring measures it: on CS3 a cover started at 0.000005 while the face beside that very test started at 0.00001, so a tighter value wrongly declared four column-edge shapes adrift. The real pocket this exists for stands three hundred times this distance from its nearest edge.

.. CG-EXPLANATION-END id=const:COLUMN_EPS

``interface PocketFace``
------------------------

.. CG-BLOCK id=interface:PocketFace lines=64-78

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/pocketFaces.ts
   :language: typescript
   :lines: 64-78
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PocketFace

**What this does.** A data shape for one loop offered to the pocket rule: its mass identity (the key two faces must share to be one body) and its ring of points.

**Why it is here.** It is the minimal input the rule needs — identity plus outline — for each face.

.. CG-EXPLANATION-END id=interface:PocketFace

``interface CoverEdges``
------------------------

.. CG-BLOCK id=interface:CoverEdges lines=79-92

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/pocketFaces.ts
   :language: typescript
   :lines: 79-92
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CoverEdges

**What this does.** A data shape for where the gap's two tests stand, in the cover's own fraction space — a low edge and a high edge, not simply 0 and 1.

**Why it is here.** The litho fill insets its regions by a real distance, so a cover's right edge lands at 0.9956 in one gap and 0.9996 in another, and a face sitting exactly on it IS beside that test whatever the arithmetic says. Measuring against a literal 1 wrongly declared four column-edge shapes adrift on CS3.

.. CG-EXPLANATION-END id=interface:CoverEdges

``function resolveIslands``
---------------------------

.. CG-BLOCK id=function:resolveIslands lines=93-166

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/pocketFaces.ts
   :language: typescript
   :lines: 93-166
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveIslands

**What this does.** The rule itself. Given a gap's labelled faces and where its two tests stand, it groups same-mass faces that touch into patches, marks which patches reach a column, records which patches lie against which, and returns for each face the face whose mass it should belong to — a face keeping its own owner maps to itself. A floating patch bounded by exactly one anchored mass is reassigned to that mass; anything else keeps what it had.

**Why it is here.** It encodes the owner's island rule precisely, and its guards are all load-bearing: exactly one MASS against a patch (not one patch — two patches of the same mass from opposite sides still enclose it), the enclosing mass must itself reach a column or there is no "around" to belong to, and unclassed ground carries no face so it leaves a side the rule cannot read and blocks absorption. The docstring notes it makes ONE pass over the fill's own decisions and never reads back its own answers mid-loop, because a pocket can never free another and reading back would make the outcome depend on emit order without changing a single scene.

.. CG-EXPLANATION-END id=function:resolveIslands

