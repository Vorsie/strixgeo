groundmodel.application.geotech_tie_tombstones
==============================================

.. CG-PAGE source=src/groundmodel/application/geotech_tie_tombstones.py complete=true

*Source file:* ``src/groundmodel/application/geotech_tie_tombstones.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-53

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_tombstones.py
   :language: python
   :lines: 1-53
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the module that remembers the ties the engineer has
deleted so the machine never proposes them again. It has three pieces named in the
docstring: record a tombstone when a tie is deleted, build one gate per section
that the derivation consults, and (in the domain) the matching arithmetic itself.

**Why it is here.** A "tombstone" is a small saved marker recording that something
was deliberately deleted, so a later rebuild does not resurrect it. The owner
ruled (2026-08-17) that a tie he deletes stays deleted — but only on the geotech
model, and keyed by the two end positions and the section it was on, not by the
row id (row ids change on every rebuild). Only HIS deletions leave a tombstone;
the machine's own housekeeping (the crossing sweep, jump-tie supersession) deletes
directly and records nothing, because a tombstone is his judgement, not the
model's. The vertical tolerance for matching is half the model's minimum band
thickness — the widest value that can never suppress a neighbouring tie by
mistake, since two boundaries on one column can never be closer than the full
minimum.

.. CG-EXPLANATION-END id=module-header

Function ``async def _investigation_xyz``
-----------------------------------------

.. CG-BLOCK id=function:_investigation_xyz lines=54-78

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_tombstones.py
   :language: python
   :lines: 54-78
   :lineno-match:

.. CG-EXPLANATION-START id=function:_investigation_xyz

**What this does.** A private helper that, given a set of CPT and borehole ids,
returns each one's map position and collar elevation, keyed by the id as text.

**Why it is here.** A column whose elevation is unknown is deliberately left out:
with no collar there is no z-height, so a tombstone can neither be written nor
matched there — and the comment states the safe direction is "the tie is not
blocked", never "the wrong tie is". The leading underscore marks it private — a
helper for this module, not part of its public surface.

.. CG-EXPLANATION-END id=function:_investigation_xyz

Function ``async def record_tie_tombstone``
-------------------------------------------

.. CG-BLOCK id=function:record_tie_tombstone lines=79-147

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_tombstones.py
   :language: python
   :lines: 79-147
   :lineno-match:

.. CG-EXPLANATION-START id=function:record_tie_tombstone

**What this does.** Given a tie being deleted, it finds each end's band, its
column, and the depth of the exact surface the tie named (its top or its base),
converts those to a map position and an ELEVATION, and saves a tombstone row
carrying both ends. Returns true when written, false when an end cannot be placed.

**Why it is here.** It stores elevation, not depth — the comment notes the key
must survive a later collar correction, so it subtracts the depth from the collar
elevation. If a band is gone, or a column has no collar, it logs the reason and
returns false, and the deletion itself proceeds anyway: the docstring is blunt
that refusing the engineer's delete over the machine's own bookkeeping would be
backwards. The row is only ``add``-ed to the session; the caller's transaction
owns the commit.

.. CG-EXPLANATION-END id=function:record_tie_tombstone

Function ``async def build_tombstone_gates``
--------------------------------------------

.. CG-BLOCK id=function:build_tombstone_gates lines=148-231

.. literalinclude:: ../../../src/groundmodel/application/geotech_tie_tombstones.py
   :language: python
   :lines: 148-231
   :lineno-match:

.. CG-EXPLANATION-START id=function:build_tombstone_gates

**What this does.** Loads every tombstone for the model, groups them by section,
loads each column's collar once, reads the tolerance (half the minimum band
thickness), and returns one gate per section that has deletions. Each gate is a
closure — a small ready-made function that carries that section's tombstones and
the collars baked into it — which takes a candidate tie the derivation is about to
propose (its two ends as column plus depth-below-collar), translates it into
elevations, and answers whether a recorded deletion covers it.

**Why it is here.** It returns an empty map — costing a single SELECT — when the
engineer has never deleted anything, which is the ordinary case. The gates
translate the derivation's depth-world into the tombstone's elevation-world
through the loaded collars, so the two never disagree about where a tie sits. A
gate that cannot compute a z (no collar) returns false — never block a tie on a
place that cannot be computed. The actual "is this tombstoned?" comparison lives
in the pure domain function; this only builds the ready-made closures around it.

.. CG-EXPLANATION-END id=function:build_tombstone_gates

