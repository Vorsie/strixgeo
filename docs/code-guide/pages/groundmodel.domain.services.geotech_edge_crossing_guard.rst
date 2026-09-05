groundmodel.domain.services.geotech_edge_crossing_guard
=======================================================

.. CG-PAGE source=src/groundmodel/domain/services/geotech_edge_crossing_guard.py complete=true

*Source file:* ``src/groundmodel/domain/services/geotech_edge_crossing_guard.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-53

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_edge_crossing_guard.py
   :language: python
   :lines: 1-53
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the module that rejects a proposed correlation
tie which would cross another tie in the same gap, and sets the crossing
tolerance. A gap is the space between two neighbouring investigation columns on
a section; a tie is one correlation line spanning it.

**Why it is here.** Owner ruling (partition-engine v2 design section 8,
question 4): crossing approved ties are a HARD CONFLICT — neither side bands,
both fall back to a pinch or lens, and the section shows a warning until the
engineer resolves it. So a machine-proposed crossing is pure friction and must
never be born. This module is only the arithmetic; the derivation owns the
registry and the accept-or-reject decision. Two ties cross when their endpoint
order is inverted between the two columns, while ties that share an endpoint
fan out rather than cross. It works in depth below collar (what the derivation
holds) while the renderer works in elevation, but the sign test comes out
identical either way.

.. CG-EXPLANATION-END id=module-header

Class ``GapTie``
----------------

.. CG-BLOCK id=class:GapTie lines=54-82

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_edge_crossing_guard.py
   :language: python
   :lines: 54-82
   :lineno-match:

.. CG-EXPLANATION-START id=class:GapTie

**What this does.** A frozen dataclass reducing one tie to the two depths it
joins in a single gap: the depth on the first column, the depth on the second,
whether the tie is accepted, and the two band ids.

**Why it is here.** The side — top or base of the band — is already folded into
each depth, so the cross test is a plain number comparison. "First" is
whichever investigation :func:`gap_key` sorted first, so a tie built
left-to-right and one built right-to-left are compared in the same frame. An
accepted tie outranks a proposal, and the band ids are carried so a rejection
can be logged with both real endpoints rather than a bare count.

.. CG-EXPLANATION-END id=class:GapTie

Function ``def gap_key``
------------------------

.. CG-BLOCK id=function:gap_key lines=83-108

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_edge_crossing_guard.py
   :language: python
   :lines: 83-108
   :lineno-match:

.. CG-EXPLANATION-START id=function:gap_key

**What this does.** Returns the two investigation ids in ascending order,
naming the gap independently of which column happened to come first.

**Why it is here.** A tie derived left-to-right and one derived right-to-left
lie in the same gap and must land in the same registry bucket, so the key is
sorted; a :class:`GapTie` built for this key stores its two depths in that same
order.

.. CG-EXPLANATION-END id=function:gap_key

Function ``def ties_cross``
---------------------------

.. CG-BLOCK id=function:ties_cross lines=109-133

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_edge_crossing_guard.py
   :language: python
   :lines: 109-133
   :lineno-match:

.. CG-EXPLANATION-START id=function:ties_cross

**What this does.** Returns whether two ties in one gap cross by taking the
depth difference between them at each column and testing whether those two
differences have opposite signs; if the ties share an endpoint within tolerance
it reports no crossing.

**Why it is here.** Inverted endpoint order between the two columns — one tie
above the other here, below it there — is the section's own definition of a
crossing. The tolerance mirrors the renderer's ``ELEV_EPS`` so the two
detectors can never disagree about what "crossing" means; it is a
numerical-noise guard, not a geological one, since real bands sit metres apart.

.. CG-EXPLANATION-END id=function:ties_cross

Function ``def crossing_partners``
----------------------------------

.. CG-BLOCK id=function:crossing_partners lines=134-153

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_edge_crossing_guard.py
   :language: python
   :lines: 134-153
   :lineno-match:

.. CG-EXPLANATION-START id=function:crossing_partners

**What this does.** Returns every already-registered tie in the gap that a
candidate tie would cross, in registration order, and an empty list when the
candidate is free to land.

**Why it is here.** The registry holds the persisted approvals seeded from the
database plus everything this derivation run has emitted so far. The caller
decides what to do with the crossed ties under the standing rule that an
accepted tie always outranks a proposal.

.. CG-EXPLANATION-END id=function:crossing_partners

