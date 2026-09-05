groundmodel.application.delete_body
===================================

.. CG-PAGE source=src/groundmodel/application/delete_body.py complete=true

*Source file:* ``src/groundmodel/application/delete_body.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../src/groundmodel/application/delete_body.py
   :language: python
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the delete-a-body file: a docstring and the imports (the two body-partition locks and ``BodyOrm``). The docstring spells out what deletion does NOT touch — formation-absence rows and synthetic pinch-out contacts are scoped to the formation, not to this metadata row, so they survive — and concludes that deletion is just a single-row delete of the name.

**Why it is here.** Position 4 architecture (#101 R3): the metadata row is only the body's label, so removing it makes the name disappear while the body itself stays in the correlation graph. Absences may already have been confirmed by the engineer as manual, so they are intentionally preserved. The docstring notes the former name ``DeleteLensMetadata``.

.. CG-EXPLANATION-END id=module-header

Class ``DeleteBody`` — header
-----------------------------

.. CG-BLOCK id=class:DeleteBody lines=33-41

.. literalinclude:: ../../../src/groundmodel/application/delete_body.py
   :language: python
   :lines: 33-41
   :lineno-match:

.. CG-EXPLANATION-START id=class:DeleteBody

**What this does.** Opens the use-case class; its docstring states it takes an active database session.

**Why it is here.** Same use-case shape as its neighbours; it inherits ``GroundModelLogger`` for logging under this module's name.

.. CG-EXPLANATION-END id=class:DeleteBody

Method ``DeleteBody``. ``def __init__``
---------------------------------------

.. CG-BLOCK id=method:DeleteBody.__init__ lines=42-46

.. literalinclude:: ../../../src/groundmodel/application/delete_body.py
   :language: python
   :lines: 42-46
   :lineno-match:

.. CG-EXPLANATION-START id=method:DeleteBody.__init__

**What this does.** Stores the handed-in session and names the logger after this module.

**Why it is here.** The caller owns the session; ``__name__`` makes the log lines read as coming from this use case.

.. CG-EXPLANATION-END id=method:DeleteBody.__init__

Method ``DeleteBody``. ``async def execute``
--------------------------------------------

.. CG-BLOCK id=method:DeleteBody.execute lines=47-115

.. literalinclude:: ../../../src/groundmodel/application/delete_body.py
   :language: python
   :lines: 47-115
   :lineno-match:

.. CG-EXPLANATION-START id=method:DeleteBody.execute

**What this does.** Logs the request; loads the ``BodyOrm`` row; returns ``False`` as a no-op if the row is missing or belongs to a different project or model; takes the model's body-partition lock and then the sibling geotech-partition locks; deletes the row and commits; returns ``True``.

**Why it is here.** The scope check turns an out-of-project id into a silent no-op rather than a deletion. The two locks follow the litho-first lock order (BP-3): deleting a litho body fires an ``ON DELETE SET NULL`` on the geotech children's parent link — a hidden write on the geotech body rows — so those child partitions must be locked before the delete to avoid racing a concurrent geotech recompute (audit 2026-08-23). A *cascade* / SET-NULL here is a database rule that changing one row automatically changes rows that point at it. The lock is taken after the not-found and scope no-ops so a rejected request never has to queue behind a live writer.

.. CG-EXPLANATION-END id=method:DeleteBody.execute

