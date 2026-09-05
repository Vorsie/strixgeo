groundmodel.application.upsert_formation_absence
================================================

.. CG-PAGE source=src/groundmodel/application/upsert_formation_absence.py complete=true

*Source file:* ``src/groundmodel/application/upsert_formation_absence.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-47

.. literalinclude:: ../../../src/groundmodel/application/upsert_formation_absence.py
   :language: python
   :lines: 1-47
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for the use case that records a formation *absence* — a statement that a named formation is not present at a given investigation. The docstring describes the two gestures it serves from the "Inspect lens body" panel: confirming an engine-inferred absence (locking it in so the next recompute will not overwrite it), and adding a manual absence the engine did not infer. Both map to one database UPSERT keyed on formation-plus-investigation.

**Why it is here.** This is part of the Position 4 absence architecture (#101). An UPSERT — insert, or update if the row already exists — lets a confirm gesture always win over the existing row. The engine-owned ``inferred`` source is rejected here on purpose: this use case is only for user-intent rows (manual or observed); the engine writes its own. The caller triggers the section refresh so the wedge geometry re-renders in the confirmed style.

.. CG-EXPLANATION-END id=module-header

Class ``UpsertFormationAbsenceResult``
--------------------------------------

.. CG-BLOCK id=class:UpsertFormationAbsenceResult lines=48-64

.. literalinclude:: ../../../src/groundmodel/application/upsert_formation_absence.py
   :language: python
   :lines: 48-64
   :lineno-match:

.. CG-EXPLANATION-START id=class:UpsertFormationAbsenceResult

**What this does.** A frozen dataclass returning the absence row's id and a flag saying whether a new row was created or an existing one updated.

**Why it is here.** The caller needs both to update its local state and to report which gesture actually happened.

.. CG-EXPLANATION-END id=class:UpsertFormationAbsenceResult

Class ``UpsertFormationAbsence`` — header
-----------------------------------------

.. CG-BLOCK id=class:UpsertFormationAbsence lines=65-73

.. literalinclude:: ../../../src/groundmodel/application/upsert_formation_absence.py
   :language: python
   :lines: 65-73
   :lineno-match:

.. CG-EXPLANATION-START id=class:UpsertFormationAbsence

**What this does.** The use-case class: create or promote a formation absence row.

**Why it is here.** One class per unit of work; it inherits the shared logger.

.. CG-EXPLANATION-END id=class:UpsertFormationAbsence

Method ``UpsertFormationAbsence``. ``def __init__``
---------------------------------------------------

.. CG-BLOCK id=method:UpsertFormationAbsence.__init__ lines=74-78

.. literalinclude:: ../../../src/groundmodel/application/upsert_formation_absence.py
   :language: python
   :lines: 74-78
   :lineno-match:

.. CG-EXPLANATION-START id=method:UpsertFormationAbsence.__init__

**What this does.** Stores the session.

**Why it is here.** The caller owns the session; the use case commits once.

.. CG-EXPLANATION-END id=method:UpsertFormationAbsence.__init__

Method ``UpsertFormationAbsence``. ``async def execute``
--------------------------------------------------------

.. CG-BLOCK id=method:UpsertFormationAbsence.execute lines=79-185

.. literalinclude:: ../../../src/groundmodel/application/upsert_formation_absence.py
   :language: python
   :lines: 79-185
   :lineno-match:

.. CG-EXPLANATION-START id=method:UpsertFormationAbsence.execute

**What this does.** Records one user-intent absence. It rejects any source other than manual or observed, checks the formation belongs to the project, checks the investigation exists in the project, then runs an insert-on-conflict-do-update that sets the source, commits, and returns the row id plus whether it was newly created (determined by comparing the returned id to the id it proposed).

**Why it is here.** Rejecting the inferred source keeps the engine's rows out of the user path. The on-conflict-do-update on the formation/investigation uniqueness constraint is what makes a confirm gesture (inferred to manual) win over the existing row regardless of its prior source.

.. CG-EXPLANATION-END id=method:UpsertFormationAbsence.execute

Method ``UpsertFormationAbsence``. ``async def _validate_investigation``
------------------------------------------------------------------------

.. CG-BLOCK id=method:UpsertFormationAbsence._validate_investigation lines=186-235

.. literalinclude:: ../../../src/groundmodel/application/upsert_formation_absence.py
   :language: python
   :lines: 186-235
   :lineno-match:

.. CG-EXPLANATION-START id=method:UpsertFormationAbsence._validate_investigation

**What this does.** Checks the named investigation exists in the project, querying the borehole table or the CPT table depending on the kind, and raises a clear error when the kind is unknown or the row is not found.

**Why it is here.** The absence's link to its investigation is polymorphic (it can point at a borehole or a CPT) and not enforced by a single foreign key, so the scope must be checked here explicitly.

.. CG-EXPLANATION-END id=method:UpsertFormationAbsence._validate_investigation

