groundmodel.application.clear_body_boundaries
=============================================

.. CG-PAGE source=src/groundmodel/application/clear_body_boundaries.py complete=true

*Source file:* ``src/groundmodel/application/clear_body_boundaries.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-42

.. literalinclude:: ../../../src/groundmodel/application/clear_body_boundaries.py
   :language: python
   :lines: 1-42
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the clear-boundaries file: a long docstring plus imports (a bulk ``delete`` statement and ``BodyBoundaryShapeOrm``). The docstring explains that the hand-shape tool stores each user-drawn boundary as a ``body_boundary_shape`` row with its ordered control-point ``body_boundary_node`` rows, that these are overrides sitting on top of the engine's computed partition, and that this use case is the bulk 'Reset manual points' that deletes them all for one model so every body returns to its computed shape.

**Why it is here.** Left-over overrides from earlier dogfeeding — shapes drawn with a previously-broken tool — can bend a body's boundary off the engine default and show visible gap wedges; this reset removes them all in one transaction. The docstring's foreign-key-cascade note records the design: the node table has an ``ON DELETE CASCADE`` on its shape (deleting a shape drops its nodes automatically in the database), and the shape carries a *denormalised* ``model_id`` — a copy of the model reference kept on the row for fast model-wide sweeps — so one bulk delete clears both tables with no join, and the returned count is the number of shapes, which is the count the engineer cares about.

.. CG-EXPLANATION-END id=module-header

Class ``ClearBodyBoundariesResult``
-----------------------------------

.. CG-BLOCK id=class:ClearBodyBoundariesResult lines=43-57

.. literalinclude:: ../../../src/groundmodel/application/clear_body_boundaries.py
   :language: python
   :lines: 43-57
   :lineno-match:

.. CG-EXPLANATION-START id=class:ClearBodyBoundariesResult

**What this does.** A frozen dataclass reporting one number: ``shapes_deleted``, how many ``body_boundary_shape`` rows were removed (one per hand-shaped body).

**Why it is here.** The docstring: the node rows are dropped by the database cascade and are not counted here, so the number reported is exactly the shapes cleared.

.. CG-EXPLANATION-END id=class:ClearBodyBoundariesResult

Class ``ClearBodyBoundaries`` — header
--------------------------------------

.. CG-BLOCK id=class:ClearBodyBoundaries lines=58-66

.. literalinclude:: ../../../src/groundmodel/application/clear_body_boundaries.py
   :language: python
   :lines: 58-66
   :lineno-match:

.. CG-EXPLANATION-START id=class:ClearBodyBoundaries

**What this does.** Opens the use-case class; its docstring states it takes an active session and commits.

**Why it is here.** Same use-case shape as its neighbours; it inherits ``GroundModelLogger`` for logging under this module's name.

.. CG-EXPLANATION-END id=class:ClearBodyBoundaries

Method ``ClearBodyBoundaries``. ``def __init__``
------------------------------------------------

.. CG-BLOCK id=method:ClearBodyBoundaries.__init__ lines=67-71

.. literalinclude:: ../../../src/groundmodel/application/clear_body_boundaries.py
   :language: python
   :lines: 67-71
   :lineno-match:

.. CG-EXPLANATION-START id=method:ClearBodyBoundaries.__init__

**What this does.** Stores the handed-in session and names the logger after this module.

**Why it is here.** The caller owns the session; ``__name__`` makes the log lines read as coming from this use case.

.. CG-EXPLANATION-END id=method:ClearBodyBoundaries.__init__

Method ``ClearBodyBoundaries``. ``async def execute``
-----------------------------------------------------

.. CG-BLOCK id=method:ClearBodyBoundaries.execute lines=72-103

.. literalinclude:: ../../../src/groundmodel/application/clear_body_boundaries.py
   :language: python
   :lines: 72-103
   :lineno-match:

.. CG-EXPLANATION-START id=method:ClearBodyBoundaries.execute

**What this does.** Logs the request; runs one bulk delete of every ``body_boundary_shape`` row for the model; reads how many rows the delete matched; commits; returns that count.

**Why it is here.** The docstring: the node rows are removed by the database cascade and do not add to the matched-row count, so the returned number is exactly the shapes removed. The docstring also records that the router does the project-scope check (``get_in_project_or_404``); this use case is purely the model-scoped delete.

.. CG-EXPLANATION-END id=method:ClearBodyBoundaries.execute

