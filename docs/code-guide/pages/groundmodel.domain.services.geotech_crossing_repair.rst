groundmodel.domain.services.geotech_crossing_repair
===================================================

.. CG-PAGE source=src/groundmodel/domain/services/geotech_crossing_repair.py complete=true

*Source file:* ``src/groundmodel/domain/services/geotech_crossing_repair.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-70

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_crossing_repair.py
   :language: python
   :lines: 1-70
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a module that sweeps crossing correlation ties
out of a geotech model, deleting MACHINE ties only, and imports the shared
:class:`GapTie` shape and the :func:`ties_cross` test from the crossing guard.

**Why it is here.** Owner ruling 2026-08-17: *"Ties shouldn't be able to cross,
if any crossing ties are in my test.strix it is because you generated them"*,
with the boundary *"user made ties should be left alone."* The emitter needed
nothing — today's derivation emits a monotone gap — but the stored rows needed
a sweep: they are legacy ``auto`` rows an older derivation produced, carried
forward every press because the re-anchor preserves accepted ties and the
crossing guard can only gate NEW candidates, not refuse a row already stored.
The rule: per section and per gap, delete machine ties until no two remaining
ties cross, always taking the tie that crosses the most others first, because
one tie inverting against three is one defect, not three. Two machine ties that
cross only each other both go — there is no honest way to pick between them. A
hand-drawn tie is never a candidate, and a fan (two ties leaving one contact
for two different ones) is kept, because it is how a pinching wedge is stated.

.. CG-EXPLANATION-END id=module-header

Class ``PersistedTie`` — header
-------------------------------

.. CG-BLOCK id=class:PersistedTie lines=71-104

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_crossing_repair.py
   :language: python
   :lines: 71-104
   :lineno-match:

.. CG-EXPLANATION-START id=class:PersistedTie

**What this does.** A frozen dataclass reducing one stored tie to what the
sweep must judge it by: the edge id, the section id, the gap as an ordered pair
of investigations, the two endpoint depths (with the top-or-base side already
resolved into each), and the source.

**Why it is here.** Correlations are section-scoped, so the same two bands may
be tied on two sections and neither can cross the other. The gap must be built
with :func:`gap_key` so a tie derived right-to-left lands in the same bucket as
one derived left-to-right. The source is carried because a ``manual`` line the
engineer drew is never deleted.

.. CG-EXPLANATION-END id=class:PersistedTie

Method ``PersistedTie``. ``def is_manual``
------------------------------------------

.. CG-BLOCK id=method:PersistedTie.is_manual lines=105-109

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_crossing_repair.py
   :language: python
   :lines: 105-109
   :lineno-match:

.. CG-EXPLANATION-START id=method:PersistedTie.is_manual

**What this does.** A property that reports whether the engineer drew this tie,
by testing whether its source is ``manual``.

**Why it is here.** A hand-drawn tie is untouchable, so the sweep asks this
before it ever considers deleting a row.

.. CG-EXPLANATION-END id=method:PersistedTie.is_manual

Method ``PersistedTie``. ``def as_gap_tie``
-------------------------------------------

.. CG-BLOCK id=method:PersistedTie.as_gap_tie lines=110-120

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_crossing_repair.py
   :language: python
   :lines: 110-120
   :lineno-match:

.. CG-EXPLANATION-START id=method:PersistedTie.as_gap_tie

**What this does.** Converts the persisted tie into the crossing guard's
:class:`GapTie` shape, reusing its two depths.

**Why it is here.** Reusing the guard's exact :func:`ties_cross` arithmetic
means the stored-row sweep and the new-candidate gate can never disagree about
what "crossing" means.

.. CG-EXPLANATION-END id=method:PersistedTie.as_gap_tie

Function ``def crossing_ties_to_delete``
----------------------------------------

.. CG-BLOCK id=function:crossing_ties_to_delete lines=121-200

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_crossing_repair.py
   :language: python
   :lines: 121-200
   :lineno-match:

.. CG-EXPLANATION-START id=function:crossing_ties_to_delete

**What this does.** Groups the ties by (section, gap); inside each group it
first counts how many others each tie crosses in the untouched set, then
repeatedly removes the non-manual tie that crosses the most others — recounting
every round — until nothing crosses or only hand-drawn ties remain. An isolated
machine pair that crosses only each other is deleted whole. It returns the ids
to delete, in input order.

**Why it is here.** Recounting each round matters because removing the worst
offender can clear several crossings at once, so survivors must be judged
against what is actually left. The pair rule reads the ORIGINAL counts, not the
live ones, because after a removal any link of a longer chain looks like an
isolated pair, and dropping each pair wholesale would strip a zigzag gap bare
instead of thinning it one tie at a time. The result is deterministic — an
isolated machine pair goes whole, any other stalemate keeps the lower id — so a
repeated press cannot churn the model, and step 2 re-derives additively so a
claim the derivation still believes simply comes back.

.. CG-EXPLANATION-END id=function:crossing_ties_to_delete

