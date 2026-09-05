groundmodel.domain.services.geotech_jump_tie_supersession
=========================================================

.. CG-PAGE source=src/groundmodel/domain/services/geotech_jump_tie_supersession.py complete=true

*Source file:* ``src/groundmodel/domain/services/geotech_jump_tie_supersession.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-70

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_jump_tie_supersession.py
   :language: python
   :lines: 1-70
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a module that marks a tie for deletion once the
chain of columns underneath it already carries the same connection, and sets a
tiny along-distance tolerance. It imports ``Mapping`` (a read-only lookup),
``dataclass`` and ``UUID``.

**Why it is here.** Owner ruling 2026-08-14: CPT-to-CPT ties should be REPLACED
by cpt-to-borehole-to-borehole-to-cpt ties once "Divide boreholes" runs —
*"just delete all"*. Keeping the long tie alongside the chain is wrong on two
counts: the fill treats a spanning tie as a deep-to-deep bridge — a straight
line across the whole span — even after the middle columns carry real bands
that disagree with that line; and the body resolver unions the two end bands
directly through it, silently overruling an intervening band that breaks the
chain. Supersession keys on GEOMETRY, never provenance: a tie is superseded
when the accepted ties whose two columns both lie inside its own along-section
span already connect its two endpoint bands, and because every such carrier is
strictly shorter, that connection must run through at least one intervening
column. Judging candidates in ascending span makes the recursion well-founded —
no tie can take part in its own replacement.

.. CG-EXPLANATION-END id=module-header

Class ``GeotechEdgeForSupersession``
------------------------------------

.. CG-BLOCK id=class:GeotechEdgeForSupersession lines=71-97

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_jump_tie_supersession.py
   :language: python
   :lines: 71-97
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechEdgeForSupersession

**What this does.** A frozen dataclass holding one edge as the judgment needs
it: the edge id (what a superseded verdict names for deletion), the two
endpoint band rows, each endpoint's investigation id, and whether the engineer
approved it.

**Why it is here.** Only ACCEPTED edges act as chain carriers, but a superseded
tie is deleted regardless of approval (*"just delete all"*). The two
investigation ids are the keys into the section's along-position map, which is
how each edge's span is measured.

.. CG-EXPLANATION-END id=class:GeotechEdgeForSupersession

Function ``def superseded_jump_tie_ids``
----------------------------------------

.. CG-BLOCK id=function:superseded_jump_tie_ids lines=98-198

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_jump_tie_supersession.py
   :language: python
   :lines: 98-198
   :lineno-match:

.. CG-EXPLANATION-START id=function:superseded_jump_tie_ids

**What this does.** For every edge it measures the along-section span between
the edge's two columns. Then, judging candidates from shortest span to longest,
it builds a union-find over band ids from only the accepted carriers that are
strictly shorter than the candidate and whose two columns both lie inside the
candidate's span; if that already joins the candidate's two end bands, the
candidate is marked superseded. It returns the ids to delete in input order.

**Why it is here.** A union-find is a grouping structure that repeatedly merges
elements and answers whether two of them ended up in the same group — here,
whether the shorter carriers already connect the two end bands. A carrier at
least as long as the candidate could bridge the two columns on its own, which
is not a chain through anything, so it is skipped; a hop that leaves the span
is a detour around the columns the chain is meant to run through, not the
chain. An edge missing an along-position is not judged at all, because nothing
should be deleted on a guess. Deleting a superseded tie never changes what the
model connects, since the tie is named only once an accepted chain already
joins the same two bands.

.. CG-EXPLANATION-END id=function:superseded_jump_tie_ids

