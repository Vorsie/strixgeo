desktop.renderer.src.utils.lithoLayerMerge
==========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/lithoLayerMerge.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/lithoLayerMerge.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLayerMerge.ts
   :language: typescript
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the imports. This file holds pure helpers for structural edits to litho ghost layers: a predicate that says whether a boundary can be merged, a function that merges two adjacent same-lithology layers, a function that absorbs a neighbour into the dragged layer, and a function that detects when a plain drag crossed a neighbour and does that absorb automatically.

**Why it is here.** The comment records that every function is kept module-level and pure — no reading or writing, no logging, no shared state — so the index-shifting maths has a tight unit-test surface without rendering, and that the model hook wrappers apply the transforms to the ghost state.

.. CG-EXPLANATION-END id=module-header

``function absorbRemainderThresholdM``
--------------------------------------

.. CG-BLOCK id=function:absorbRemainderThresholdM lines=38-57

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLayerMerge.ts
   :language: typescript
   :lines: 38-57
   :lineno-match:

.. CG-EXPLANATION-START id=function:absorbRemainderThresholdM

**What this does.** Returns the sliver size below which a drag-to-collapse finishes the absorb rather than leaving a thin band: the larger of 0.1 m or 15 percent of the neighbour's original thickness.

**Why it is here.** The docstring records that a strict "must fully cross" rule was too tight — releasing a few pixels short of the far edge left a near-zero band (dogfeed 2026-05-31) — and that this is exported because the geotech boundary drag uses the very same rule (owner decision 2026-08-07, "Absorb, like litho"), so having one shared helper means the two axes' absorb feel can never drift apart.

.. CG-EXPLANATION-END id=function:absorbRemainderThresholdM

``function canMergeAt``
-----------------------

.. CG-BLOCK id=function:canMergeAt lines=58-107

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLayerMerge.ts
   :language: typescript
   :lines: 58-107
   :lineno-match:

.. CG-EXPLANATION-START id=function:canMergeAt

**What this does.** Answers whether the boundary between a layer and the one below it can be merged: both layers must be pending — not accepted, not rejected — and share the same current lithology. An out-of-range position simply returns false.

**Why it is here.** The docstring records that the boundary right-click menu uses it to decide whether to offer "Merge layers", and the hook handler uses the same predicate again as a second-line guard before merging. It takes the four pieces of ghost state separately so the component, which holds them as separate props, can call it without rebuilding the bundle, and it range-checks internally so the caller does not have to.

.. CG-EXPLANATION-END id=function:canMergeAt

``function mergeLithoLayers``
-----------------------------

.. CG-BLOCK id=function:mergeLithoLayers lines=108-191

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLayerMerge.ts
   :language: typescript
   :lines: 108-191
   :lineno-match:

.. CG-EXPLANATION-START id=function:mergeLithoLayers

**What this does.** Merges the layer at ``upperIdx`` with the one below it into a single layer at that position: it drops the lower layer, shifts higher positions down by one, keeps the upper layer's composition, and extends the merged layer's base down to the lower layer's base.

**Why it is here.** The docstring records that the merged layer keeps the upper layer's lithology and admixtures — the engineer can edit afterwards, and automatically combining the two compositions is deliberately deferred (debt #102). The function is pure, and the caller only reaches it through the ``canMergeAt`` gate.

.. CG-EXPLANATION-END id=function:mergeLithoLayers

``function absorbLithoLayer``
-----------------------------

.. CG-BLOCK id=function:absorbLithoLayer lines=192-306

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLayerMerge.ts
   :language: typescript
   :lines: 192-306
   :lineno-match:

.. CG-EXPLANATION-START id=function:absorbLithoLayer

**What this does.** Absorbs the immediate neighbour into the dragged layer in a given direction: the dragged layer's depth extends to the neighbour's far edge, the neighbour is removed, higher positions shift down by one, and the dragged layer's composition is kept.

**Why it is here.** The docstring records the direction meanings (down absorbs the layer below, up the layer above), that the absorbed neighbour's composition and state are discarded because the dragger wins, and that the function does not check the neighbour exists or is pending — the drag handler gate-checks that before calling. It is pure.

.. CG-EXPLANATION-END id=function:absorbLithoLayer

``function absorbThroughLayer``
-------------------------------

.. CG-BLOCK id=function:absorbThroughLayer lines=307-388

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLayerMerge.ts
   :language: typescript
   :lines: 307-388
   :lineno-match:

.. CG-EXPLANATION-START id=function:absorbThroughLayer

**What this does.** The general form of the absorb: it swallows the whole run of layers between the dragged layer and a target neighbour — the target plus any rejected layers the drag passed over — extends the dragged layer's depth to the target's far edge, and rebuilds the position-keyed sets so entries inside the removed run are dropped and entries above shift down by the number removed. When the target is the immediate neighbour it behaves exactly like the simple absorb.

**Why it is here.** The docstring records that consuming the rejected in-between layers is the whole point: it leaves no stale positions pointing at layers that no longer exist in the list. The function is pure.

.. CG-EXPLANATION-END id=function:absorbThroughLayer

``function effectiveEdge``
--------------------------

.. CG-BLOCK id=function:effectiveEdge lines=389-439

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLayerMerge.ts
   :language: typescript
   :lines: 389-439
   :lineno-match:

.. CG-EXPLANATION-START id=function:effectiveEdge

**What this does.** Reads the current depth of one edge of a layer — an edit winning over the raw suggested value — and returns nothing when the position is out of range.

**Why it is here.** The docstring records that callers MUST handle the empty case: a stale position reaching this point once crashed with a "cannot read property" error right after a Suggest-all replaced the anchor's layer list while a deferred edit still carried the old position (dogfeed 2026-05-26).

.. CG-EXPLANATION-END id=function:effectiveEdge

``function applyCrossMergeOnDrag``
----------------------------------

.. CG-BLOCK id=function:applyCrossMergeOnDrag lines=440-562

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoLayerMerge.ts
   :language: typescript
   :lines: 440-562
   :lineno-match:

.. CG-EXPLANATION-START id=function:applyCrossMergeOnDrag

**What this does.** Applies a depth edit to one layer and checks whether it crossed a pending neighbour's boundary. If it did, it absorbs that neighbour so the stack collapses in a single step — the same result as the Shift-drag absorb but fired automatically on release; if it did not, it just records the edit. A top edge dragged up scans upward for the nearest pending neighbour (skipping rejected layers, stopping at an accepted one) and absorbs it once the dragger has eaten it down to a sliver; a base edge dragged down mirrors that.

**Why it is here.** The docstring and comments record that only pending neighbours are eligible — accepted layers are frozen committed contacts, rejected layers are treated as gaps — and that several guards were added after crashes and a double-absorb bug (dogfeed 2026-05-26 / 05-31): a stale position after a Suggest-all is ignored, a composition-only or no-op edit skips the neighbour scan, and a shared-boundary "propagate only" partner edit must not re-scan or it would absorb in the wrong direction. It uses the range-absorbing form rather than the single-neighbour one so the rejected layers in between are consumed too, fixing the "two sand bands plus a sliver" phantom.

.. CG-EXPLANATION-END id=function:applyCrossMergeOnDrag

