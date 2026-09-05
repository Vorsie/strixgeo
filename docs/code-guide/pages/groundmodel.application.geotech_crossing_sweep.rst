groundmodel.application.geotech_crossing_sweep
==============================================

.. CG-PAGE source=src/groundmodel/application/geotech_crossing_sweep.py complete=true

*Source file:* ``src/groundmodel/application/geotech_crossing_sweep.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../src/groundmodel/application/geotech_crossing_sweep.py
   :language: python
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens a module whose one job is to delete stored packing ties
that cross another tie in the same gap between two columns. It imports the pure
crossing arithmetic from the domain and the database row types it will load and
delete.

**Why it is here.** A "tie" (also called a correlation) is the engineer's line
joining a band on one column to a band on the next. The owner ruled (2026-08-17)
that ties must never cross, and that any crossing pair in his file was
machine-made, not drawn by hand. The docstring records that both halves were
checked first: today's derivation no longer emits crossings (an emit-time guard
refuses them), and the crossings he saw were LEGACY rows from an older derivation
that the re-anchor faithfully carries across every rebuild. So the fix is a sweep
over the already-stored rows, run after the writers have finished. The "does this
pair cross?" arithmetic is a pure domain function (no database, runnable on
paper); this module is the database half — load, judge, delete, report.

.. CG-EXPLANATION-END id=module-header

Function ``async def sweep_crossing_ties``
------------------------------------------

.. CG-BLOCK id=function:sweep_crossing_ties lines=42-134

.. literalinclude:: ../../../src/groundmodel/application/geotech_crossing_sweep.py
   :language: python
   :lines: 42-134
   :lineno-match:

.. CG-EXPLANATION-START id=function:sweep_crossing_ties

**What this does.** Loads every correlation edge on the geotech model plus every
band's column and depth, turns each edge into a plain record of where its two ends
sit (which column, at what depth below the collar), asks the pure domain function
which ones cross, deletes exactly those, logs the count, and returns it.

**Why it is here.** It works in depth below the collar rather than in elevation
because — as the comment notes — both differences the crossing test takes are
within a single column, so measuring from the collar or from sea level gives the
same answer. An edge whose band has been deleted is skipped, because an end that
cannot be placed cannot be judged (the foreign-key cascade — the database's own
rule that removes an edge when the band it points at is removed — owns that row,
not this sweep). The return count is reported deliberately: the docstring says a
silent deletion of the engineer's correlations is exactly what he must never
discover for himself, so even zero is worth stating. The DELETE is issued into the
caller's transaction (a group of writes that all land together or not at all) and
this function never commits on its own, so the whole geotech press stays one
all-or-nothing unit.

.. CG-EXPLANATION-END id=function:sweep_crossing_ties

