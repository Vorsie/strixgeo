groundmodel.application.update_formation_contacts_batch
=======================================================

.. CG-PAGE source=src/groundmodel/application/update_formation_contacts_batch.py complete=true

*Source file:* ``src/groundmodel/application/update_formation_contacts_batch.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-36

.. literalinclude:: ../../../src/groundmodel/application/update_formation_contacts_batch.py
   :language: python
   :lines: 1-36
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for the batch-update use case, which applies many contact patches at once. The docstring states the all-or-nothing rule: every target must already exist and belong to the given model, and any miss aborts before any change is made.

**Why it is here.** The section editor's multi-drag can move several contacts together. Doing that as N separate web calls is both racy (a mid-batch failure leaves the model inconsistent) and slow (N round-trips), so the whole set is validated first and applied in one transaction.

.. CG-EXPLANATION-END id=module-header

Class ``UpdateFormationContactsBatch`` — header
-----------------------------------------------

.. CG-BLOCK id=class:UpdateFormationContactsBatch lines=37-39

.. literalinclude:: ../../../src/groundmodel/application/update_formation_contacts_batch.py
   :language: python
   :lines: 37-39
   :lineno-match:

.. CG-EXPLANATION-START id=class:UpdateFormationContactsBatch

**What this does.** The use-case class: apply N partial updates to formation contacts and commit once.

**Why it is here.** One class per unit of work; it inherits the shared logger.

.. CG-EXPLANATION-END id=class:UpdateFormationContactsBatch

Method ``UpdateFormationContactsBatch``. ``def __init__``
---------------------------------------------------------

.. CG-BLOCK id=method:UpdateFormationContactsBatch.__init__ lines=40-45

.. literalinclude:: ../../../src/groundmodel/application/update_formation_contacts_batch.py
   :language: python
   :lines: 40-45
   :lineno-match:

.. CG-EXPLANATION-START id=method:UpdateFormationContactsBatch.__init__

**What this does.** Stores the session and builds a geology repository over it.

**Why it is here.** The caller owns the session; the use case commits once.

.. CG-EXPLANATION-END id=method:UpdateFormationContactsBatch.__init__

Method ``UpdateFormationContactsBatch``. ``async def execute``
--------------------------------------------------------------

.. CG-BLOCK id=method:UpdateFormationContactsBatch.execute lines=46-137

.. literalinclude:: ../../../src/groundmodel/application/update_formation_contacts_batch.py
   :language: python
   :lines: 46-137
   :lineno-match:

.. CG-EXPLANATION-START id=method:UpdateFormationContactsBatch.execute

**What this does.** Loads every target contact in one query, checks each exists and belongs to the given model (returning nothing on any miss), records the affected model-and-formation pairs, applies each patch by setting the fields on the loaded rows, flushes, adds the post-update pairs so a formation swap refreshes both old and new surfaces, marks all affected surfaces stale in one bulk update, mirrors that to the 3-D solid cache, commits, refreshes, and returns the snapshots in the same order as the input.

**Why it is here.** The single load-and-check pass gives the all-or-nothing guarantee: no row is mutated unless every row passes scope. Returning results in input order lets the desktop patch its local state by index. Marking surfaces stale rather than rebuilding is the on-click-build contract; the 3-D mirror is a safe no-op for a geological model.

.. CG-EXPLANATION-END id=method:UpdateFormationContactsBatch.execute

