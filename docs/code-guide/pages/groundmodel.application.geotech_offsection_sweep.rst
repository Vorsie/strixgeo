groundmodel.application.geotech_offsection_sweep
================================================

.. CG-PAGE source=src/groundmodel/application/geotech_offsection_sweep.py complete=true

*Source file:* ``src/groundmodel/application/geotech_offsection_sweep.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-51

.. literalinclude:: ../../../src/groundmodel/application/geotech_offsection_sweep.py
   :language: python
   :lines: 1-51
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens a module that deletes machine PROPOSALS which tie a
column the section does not actually draw.

**Why it is here.** A section projects the nearby CPTs and boreholes onto its line;
one that falls before the line's start endpoint is not drawn on it. The owner saw
(2026-08-25) a pending machine tie to such a borehole and ruled it section-scoped.
The emitter is already fixed at its inputs — every geotech writer now reads the
section's membership as a required argument — but a fixed emitter cannot reach a
row already stored. Those are LEGACY rows: the projection filter only gained its
between-the-endpoints clamp on 2026-08-03, and presses since have faithfully
restated the pre-clamp correlations that survived it. A proposal on a gap the
engineer cannot see is one he can neither accept nor reject — it would sit in his
review count forever. Hence a sweep over the stored rows, run after the derivation.
It touches ONLY unapproved ``source='auto'`` rows; an accepted or hand-drawn tie
is his own statement about the ground, so it is counted and warned about, not
deleted — mirroring the crossing sweep's rule that user-made ties are left alone.
The pair itself is not lost, because the section that *does* draw both columns
proposes it there.

.. CG-EXPLANATION-END id=module-header

Class ``OffSectionSweepResult``
-------------------------------

.. CG-BLOCK id=class:OffSectionSweepResult lines=52-70

.. literalinclude:: ../../../src/groundmodel/application/geotech_offsection_sweep.py
   :language: python
   :lines: 52-70
   :lineno-match:

.. CG-EXPLANATION-START id=class:OffSectionSweepResult

**What this does.** A frozen dataclass with two counts: how many proposals were
deleted, and how many mis-scoped ties were kept because they are accepted or
hand-drawn.

**Why it is here.** Both numbers are reported, the retained ones at WARNING level:
a mis-scoped tie the engineer approved is wrong for its section but carries his
judgement, so only he may take it back, and the log names the column so he can. The
defaults are zero, so the "nothing in scope" path returns an empty result cleanly.

.. CG-EXPLANATION-END id=class:OffSectionSweepResult

Function ``async def sweep_offsection_pending_ties``
----------------------------------------------------

.. CG-BLOCK id=function:sweep_offsection_pending_ties lines=71-207

.. literalinclude:: ../../../src/groundmodel/application/geotech_offsection_sweep.py
   :language: python
   :lines: 71-207
   :lineno-match:

.. CG-EXPLANATION-START id=function:sweep_offsection_pending_ties

**What this does.** For the sections in scope, loads their edges and every band's
column, and for each edge finds which of its two columns the section does not draw.
A mis-scoped edge that is an unapproved machine proposal is deleted; a mis-scoped
edge that is accepted or hand-drawn is kept and logged at WARNING with the column
names; an edge whose band is gone is skipped. Returns the deleted and retained
counts.

**Why it is here.** It keys the band-to-column map borehole-first then CPT, the
same order every other geotech reader uses, so "which column is this band on?" has
one answer across the whole module set (the comment says so). An edge whose section
is absent from the scope map is left completely alone — a section-scoped press must
never reach into a section the engineer did not ask about. The column names are
resolved once and formatted per row because a raw id in the warning is unreadable,
and the whole point of the line is that he can go and look at the column it names.
The DELETE lands in the caller's transaction.

.. CG-EXPLANATION-END id=function:sweep_offsection_pending_ties

