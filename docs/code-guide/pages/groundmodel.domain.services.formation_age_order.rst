groundmodel.domain.services.formation_age_order
===============================================

.. CG-PAGE source=src/groundmodel/domain/services/formation_age_order.py complete=true

*Source file:* ``src/groundmodel/domain/services/formation_age_order.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../src/groundmodel/domain/services/formation_age_order.py
   :language: python
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the helper that infers a youngest-to-oldest formation ordering from per-investigation contact depths, and imports the collection, sequence and id tools.

**Why it is here.** The docstring explains the geology: on one borehole a shallower contact is a younger formation and a deeper one is older, giving an unambiguous local order; across many boreholes the union of those local orders is a directed graph of is-younger-than relationships, which a topological sort turns into one globally consistent sequence. This is more robust than ranking by mean elevation, because regional dip shifts a formation's mean elevation while the per-borehole pairwise order is immune to dip.

.. CG-EXPLANATION-END id=module-header

Function ``def infer_age_order``
--------------------------------

.. CG-BLOCK id=function:infer_age_order lines=29-159

.. literalinclude:: ../../../src/groundmodel/domain/services/formation_age_order.py
   :language: python
   :lines: 29-159
   :lineno-match:

.. CG-EXPLANATION-START id=function:infer_age_order

**What this does.** Collects a younger-than vote for every shallower-deeper contact pair on each investigation, resolves contradictory votes by majority (with a mean-depth tie-break), builds a directed graph, and walks it youngest-first with Kahn's algorithm. Formations with no contacts are appended last in id order. It returns the youngest-first list.

**Why it is here.** A directed graph here is a set of one-way is-younger-than links; a topological sort orders the nodes so every link points forward. The docstring records every edge case handled deterministically: orphans append at the end, single-contact formations slot in by mean depth, contradictory anchors keep the better-supported direction, and any formation left unreached by a rare contradiction cycle is appended by mean depth. The order is fully deterministic so a rebuild and a bundle round-trip reproduce it exactly, which the caller relies on for the display order.

.. CG-EXPLANATION-END id=function:infer_age_order

