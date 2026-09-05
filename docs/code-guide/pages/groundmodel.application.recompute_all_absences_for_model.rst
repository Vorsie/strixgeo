groundmodel.application.recompute_all_absences_for_model
========================================================

.. CG-PAGE source=src/groundmodel/application/recompute_all_absences_for_model.py complete=true

*Source file:* ``src/groundmodel/application/recompute_all_absences_for_model.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-61

.. literalinclude:: ../../../src/groundmodel/application/recompute_all_absences_for_model.py
   :language: python
   :lines: 1-61
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for the whole-model absence recompute — the one-shot companion to a bulk-accept flow. The docstring explains the architecture (it delegates per-formation to the formation-level trigger and the wedge-tip materialiser), the atomicity model (one commit, each formation inside its own database SAVEPOINT), and the guards (model must exist, be lithostratigraphic, and only formations that actually have contacts are processed).

**Why it is here.** The batch-accept endpoint defers per-anchor inference and calls this once, so inference runs a single pass per touched formation instead of multiplying across anchors, formations and sections. A SAVEPOINT — a nested checkpoint inside a transaction that can be rolled back on its own — lets one broken formation's writes be undone while the successful formations remain staged for the single final commit (#212); an unexpected error still rolls back the whole batch and re-raises.

.. CG-EXPLANATION-END id=module-header

Class ``RecomputeAllAbsencesResult``
------------------------------------

.. CG-BLOCK id=class:RecomputeAllAbsencesResult lines=62-88

.. literalinclude:: ../../../src/groundmodel/application/recompute_all_absences_for_model.py
   :language: python
   :lines: 62-88
   :lineno-match:

.. CG-EXPLANATION-START id=class:RecomputeAllAbsencesResult

**What this does.** A dataclass with the batch totals: formations processed, absence rows written and retracted, and wedge-tip contacts created and deleted.

**Why it is here.** The caller reports the whole batch's effect from these totals.

.. CG-EXPLANATION-END id=class:RecomputeAllAbsencesResult

Class ``RecomputeAllAbsencesForModel`` — header
-----------------------------------------------

.. CG-BLOCK id=class:RecomputeAllAbsencesForModel lines=89-107

.. literalinclude:: ../../../src/groundmodel/application/recompute_all_absences_for_model.py
   :language: python
   :lines: 89-107
   :lineno-match:

.. CG-EXPLANATION-START id=class:RecomputeAllAbsencesForModel

**What this does.** The use-case class: bulk inference recompute for every formation in a lithostratigraphic model, accumulated in one transaction and committed once.

**Why it is here.** One class per unit of work; it inherits the shared logger. The caller must not commit before it runs.

.. CG-EXPLANATION-END id=class:RecomputeAllAbsencesForModel

Method ``RecomputeAllAbsencesForModel``. ``def __init__``
---------------------------------------------------------

.. CG-BLOCK id=method:RecomputeAllAbsencesForModel.__init__ lines=108-112

.. literalinclude:: ../../../src/groundmodel/application/recompute_all_absences_for_model.py
   :language: python
   :lines: 108-112
   :lineno-match:

.. CG-EXPLANATION-START id=method:RecomputeAllAbsencesForModel.__init__

**What this does.** Stores the session.

**Why it is here.** The caller owns the session; this use case commits once at the end.

.. CG-EXPLANATION-END id=method:RecomputeAllAbsencesForModel.__init__

Method ``RecomputeAllAbsencesForModel``. ``async def execute``
--------------------------------------------------------------

.. CG-BLOCK id=method:RecomputeAllAbsencesForModel.execute lines=113-314

.. literalinclude:: ../../../src/groundmodel/application/recompute_all_absences_for_model.py
   :language: python
   :lines: 113-314
   :lineno-match:

.. CG-EXPLANATION-START id=method:RecomputeAllAbsencesForModel.execute

**What this does.** Recomputes inference for every formation with contacts in the model. It scope-guards the model and checks it is lithostratigraphic; discovers the distinct formation ids that have contacts (narrowed to a caller-supplied subset for an incremental recompute); builds the per-section cache once (corridor plus observation layers per section); then loops the formations with a progress index, running the formation-level inference and the wedge-tip materialiser for each inside its own savepoint with commit deferred, accumulating the totals; and finally commits once. A per-formation data error rolls back only that formation's savepoint and is skipped; an unexpected error rolls back the whole batch and re-raises.

**Why it is here.** Only formations with contacts can have inferred absences, so the discovery narrows the work. The optional formation-id filter is the incremental recompute (#155): a bulk accept re-infers only the formations it touched, turning per-accept inference from cost-of-the-whole-model into cost-of-the-accepted. Building the section cache once is the #153 hoist that removes the redundant corridor and observation scans across formations. The per-formation savepoint (rather than one flat transaction) is what stops a single broken formation's partial writes from riding the final commit.

.. CG-EXPLANATION-END id=method:RecomputeAllAbsencesForModel.execute

