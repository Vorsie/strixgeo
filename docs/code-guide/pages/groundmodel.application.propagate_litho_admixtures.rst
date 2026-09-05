groundmodel.application.propagate_litho_admixtures
==================================================

.. CG-PAGE source=src/groundmodel/application/propagate_litho_admixtures.py complete=true

*Source file:* ``src/groundmodel/application/propagate_litho_admixtures.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../src/groundmodel/application/propagate_litho_admixtures.py
   :language: python
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the propagate-admixtures file. It imports the scope guard, the domain correlation-edge type and connected-component helper, and the database rows, and its docstring scopes the change to admixtures only.

**Why it is here.** Only the admixtures column is touched, so no resolver re-run is needed — the naming group and ordinals are unchanged. A seed formation with no edges is its own singleton component, so the edit still applies to it alone.

.. CG-EXPLANATION-END id=module-header

Class ``PropagateAdmixturesResult``
-----------------------------------

.. CG-BLOCK id=class:PropagateAdmixturesResult lines=40-56

.. literalinclude:: ../../../src/groundmodel/application/propagate_litho_admixtures.py
   :language: python
   :lines: 40-56
   :lineno-match:

.. CG-EXPLANATION-START id=class:PropagateAdmixturesResult

**What this does.** A dataclass carrying the updated formation rows and the size of the connected component.

**Why it is here.** The rows are refreshed after commit so the caller can serialise them directly.

.. CG-EXPLANATION-END id=class:PropagateAdmixturesResult

Class ``PropagateLithoAdmixtures`` — header
-------------------------------------------

.. CG-BLOCK id=class:PropagateLithoAdmixtures lines=57-72

.. literalinclude:: ../../../src/groundmodel/application/propagate_litho_admixtures.py
   :language: python
   :lines: 57-72
   :lineno-match:

.. CG-EXPLANATION-START id=class:PropagateLithoAdmixtures

**What this does.** The use case that writes an admixture list to every formation in a seed's correlated body, found by a breadth-first search over the model's correlation edges.

**Why it is here.** The docstring lists the guards: the seed and model must exist and belong to the project, the model must be lithostratigraphic, and the seed must be a litho unit (have a soil code), so a geological-model row passed in error is rejected.

.. CG-EXPLANATION-END id=class:PropagateLithoAdmixtures

Method ``PropagateLithoAdmixtures``. ``def __init__``
-----------------------------------------------------

.. CG-BLOCK id=method:PropagateLithoAdmixtures.__init__ lines=73-77

.. literalinclude:: ../../../src/groundmodel/application/propagate_litho_admixtures.py
   :language: python
   :lines: 73-77
   :lineno-match:

.. CG-EXPLANATION-START id=method:PropagateLithoAdmixtures.__init__

**What this does.** Stores the session.

**Why it is here.** The caller owns the session; this use case writes through it.

.. CG-EXPLANATION-END id=method:PropagateLithoAdmixtures.__init__

Method ``PropagateLithoAdmixtures``. ``async def execute``
----------------------------------------------------------

.. CG-BLOCK id=method:PropagateLithoAdmixtures.execute lines=78-261

.. literalinclude:: ../../../src/groundmodel/application/propagate_litho_admixtures.py
   :language: python
   :lines: 78-261
   :lineno-match:

.. CG-EXPLANATION-START id=method:PropagateLithoAdmixtures.execute

**What this does.** Guards the model and seed, derives formation-to-formation edges from the approved contact edges, finds the seed's connected component by breadth-first search, loads those formations, writes the admixture list to each with its own copy, and commits with a refresh.

**Why it is here.** Contact edges are the boundary-to-boundary ground truth since issue #133 phase 3, so the formation graph is derived from them, skipping self-loops and orphan edges. Each formation gets its own copy of the list so a later change to one row's JSON does not alias the others. An empty list clears the body's admixtures.

.. CG-EXPLANATION-END id=method:PropagateLithoAdmixtures.execute

