groundmodel.application.get_model_footprint
===========================================

.. CG-PAGE source=src/groundmodel/application/get_model_footprint.py complete=true

*Source file:* ``src/groundmodel/application/get_model_footprint.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-85

.. literalinclude:: ../../../src/groundmodel/application/get_model_footprint.py
   :language: python
   :lines: 1-85
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the footprint file. It imports the build's column grouper and payload rehydrator, the domain footprint builder, and the generation row, and defines three unavailable reasons. Its docstring explains it re-derives the footprint ring from the last stored build.

**Why it is here.** The 3-D viewer draws the footprint as a closed ring so the model's edge reads as an edge, not a hole (owner 2026-08-26). The ring must be the exact hull the build clipped to, so a client-side re-derivation would be a second source of truth; the stored payload persists the build input as received, so the hull is fully reproducible from stored state. It replays the build's own footprint computation, and skips body-aliasing and true-position re-seating because neither moves the hull (verified by reading the build code, not assumed).

.. CG-EXPLANATION-END id=module-header

Class ``ModelFootprintOutcome``
-------------------------------

.. CG-BLOCK id=class:ModelFootprintOutcome lines=86-111

.. literalinclude:: ../../../src/groundmodel/application/get_model_footprint.py
   :language: python
   :lines: 86-111
   :lineno-match:

.. CG-EXPLANATION-START id=class:ModelFootprintOutcome

**What this does.** A frozen dataclass carrying the closed ring vertices, the build generation and time it came from, and a plain reason when the ring is empty.

**Why it is here.** A missing or degenerate build state answers an empty ring with a human reason rather than an error, so the viewer's footprint request never turns nothing-built into a failure.

.. CG-EXPLANATION-END id=class:ModelFootprintOutcome

Class ``GetModelFootprint`` — header
------------------------------------

.. CG-BLOCK id=class:GetModelFootprint lines=112-126

.. literalinclude:: ../../../src/groundmodel/application/get_model_footprint.py
   :language: python
   :lines: 112-126
   :lineno-match:

.. CG-EXPLANATION-START id=class:GetModelFootprint

**What this does.** The read-only use case that re-derives a model's footprint ring from its last build.

**Why it is here.** A pure read that replays the build's footprint computation, so the ring the viewer draws always matches the actual build geometry.

.. CG-EXPLANATION-END id=class:GetModelFootprint

Method ``GetModelFootprint``. ``def __init__``
----------------------------------------------

.. CG-BLOCK id=method:GetModelFootprint.__init__ lines=127-131

.. literalinclude:: ../../../src/groundmodel/application/get_model_footprint.py
   :language: python
   :lines: 127-131
   :lineno-match:

.. CG-EXPLANATION-START id=method:GetModelFootprint.__init__

**What this does.** Stores the session.

**Why it is here.** The caller owns the session; this use case only reads.

.. CG-EXPLANATION-END id=method:GetModelFootprint.__init__

Method ``GetModelFootprint``. ``async def execute``
---------------------------------------------------

.. CG-BLOCK id=method:GetModelFootprint.execute lines=132-213

.. literalinclude:: ../../../src/groundmodel/application/get_model_footprint.py
   :language: python
   :lines: 132-213
   :lineno-match:

.. CG-EXPLANATION-START id=method:GetModelFootprint.execute

**What this does.** Loads the latest build generation, rehydrates its payload into domain sections, loads the resolved picks as investigation columns, and rebuilds the footprint, returning the ring or an empty ring with a reason at each failure point.

**Why it is here.** It never raises for a degenerate or missing state — no build yet, an unreadable payload (likely an older build), or a footprint that cannot frame a hull each answer with the matching reason — so the viewer's request stays an ordinary answer.

.. CG-EXPLANATION-END id=method:GetModelFootprint.execute

Method ``GetModelFootprint``. ``async def _latest_generation``
--------------------------------------------------------------

.. CG-BLOCK id=method:GetModelFootprint._latest_generation lines=214-234

.. literalinclude:: ../../../src/groundmodel/application/get_model_footprint.py
   :language: python
   :lines: 214-234
   :lineno-match:

.. CG-EXPLANATION-START id=method:GetModelFootprint._latest_generation

**What this does.** Returns the most recently created build generation for the model, or nothing.

**Why it is here.** The footprint is derived from the newest build, so the query orders by creation time and takes one.

.. CG-EXPLANATION-END id=method:GetModelFootprint._latest_generation

