groundmodel.domain.services.detect_crossing_pinch_outs
======================================================

.. CG-PAGE source=src/groundmodel/domain/services/detect_crossing_pinch_outs.py complete=true

*Source file:* ``src/groundmodel/domain/services/detect_crossing_pinch_outs.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../src/groundmodel/domain/services/detect_crossing_pinch_outs.py
   :language: python
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the pure detector that turns crossing correlation lines into pinch-out lens candidates, and imports the shared contact-stack types it reuses.

**Why it is here.** The docstring records the geometry: when two correlation edges between the same column pair CROSS (the shallower contact on one column maps to the deeper contact on the other), the layer between them cannot be a flat continuous bed and must pinch out. This complements the tightened auto-correlate window, which stops drawing the steep diagonal, by recognising the geometry it leaves behind as a lens for the engineer to see.

.. CG-EXPLANATION-END id=module-header

Class ``CrossingPinchOut``
--------------------------

.. CG-BLOCK id=class:CrossingPinchOut lines=30-62

.. literalinclude:: ../../../src/groundmodel/domain/services/detect_crossing_pinch_outs.py
   :language: python
   :lines: 30-62
   :lineno-match:

.. CG-EXPLANATION-START id=class:CrossingPinchOut

**What this does.** A frozen data holder for one inferred pinch-out: the source column carrying the two framing contacts, the shallower and deeper framing contacts, the neighbour column it pinches toward, and the two crossing edges as unordered pairs.

**Why it is here.** The caller drops both crossing edges from persistence (neither is a flat correlation) and keeps this pinch-out instead. The source column is chosen deterministically as the lower-id column of the pair, so the same crossing always frames the same way; the docstring notes a finer which-side-wedges refinement can layer on later when section positions are available.

.. CG-EXPLANATION-END id=class:CrossingPinchOut

Function ``def detect_crossing_pinch_outs``
-------------------------------------------

.. CG-BLOCK id=function:detect_crossing_pinch_outs lines=63-159

.. literalinclude:: ../../../src/groundmodel/domain/services/detect_crossing_pinch_outs.py
   :language: python
   :lines: 63-159
   :lineno-match:

.. CG-EXPLANATION-START id=function:detect_crossing_pinch_outs

**What this does.** Builds a lookup from contact id to its column and depth, groups the edges by unordered column pair (dropping same-column and dangling edges), then within each pair normalises the edges to a consistent left column, sorts them by left-column depth, and flags any place where the right-column depth goes SHALLOWER as the left goes deeper. Each such inversion frames a pinching layer. It returns the records sorted for determinism.

**Why it is here.** An inversion in the right-column depth order between two left-sorted edges IS the crossing, which is the pinch-out signature. Normalising every pair to a fixed left column and sorting canonically makes the detection order-independent and reproducible. Dangling edges (an endpoint not in any stack) are skipped silently rather than crashing.

.. CG-EXPLANATION-END id=function:detect_crossing_pinch_outs

