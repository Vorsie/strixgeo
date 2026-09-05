groundmodel.application.reconcile_bodies_after_restore
======================================================

.. CG-PAGE source=src/groundmodel/application/reconcile_bodies_after_restore.py complete=true

*Source file:* ``src/groundmodel/application/reconcile_bodies_after_restore.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../src/groundmodel/application/reconcile_bodies_after_restore.py
   :language: python
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the post-restore reconcile file. It imports the resolver, the model row and the kind constants, and its docstring explains why body ids are re-derived after a restore.

**Why it is here.** The bundle does not carry the layer body id (bodies restore in a later phase than layers, so restoring it verbatim would violate a foreign key), so it is re-derived by re-running the resolver from each model's approved edges. It was extracted from the restore route so the reconcile runs for every body-bearing model kind, not just the one the route happened to query.

.. CG-EXPLANATION-END id=module-header

Function ``async def reconcile_bodies_after_restore``
-----------------------------------------------------

.. CG-BLOCK id=function:reconcile_bodies_after_restore lines=25-58

.. literalinclude:: ../../../src/groundmodel/application/reconcile_bodies_after_restore.py
   :language: python
   :lines: 25-58
   :lineno-match:

.. CG-EXPLANATION-START id=function:reconcile_bodies_after_restore

**What this does.** Re-runs the resolver, without committing, for every lithostratigraphic and geotechnical model of the project, in the litho-then-geotech order.

**Why it is here.** Both kinds carry a layer body id, so reopening a subdivided project must reconcile both or the geotech grouping reopens empty until the next subdivide. Each resolve takes that model's body-partition lock and holds it to the commit, so the loop walks litho before geotech (the order subdivide takes) to avoid a deadlock, with the id breaking ties so the order does not depend on database row order.

.. CG-EXPLANATION-END id=function:reconcile_bodies_after_restore

