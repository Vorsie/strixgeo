groundmodel.application.update_litho_layer
==========================================

.. CG-PAGE source=src/groundmodel/application/update_litho_layer.py complete=true

*Source file:* ``src/groundmodel/application/update_litho_layer.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../src/groundmodel/application/update_litho_layer.py
   :language: python
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the update-layer file. It imports the body-partition locks, the layer row and repository, and the overlap error, and names the no-overlap database constraint. The docstring says it patches one layer's fields through the application layer.

**Why it is here.** Routing a single-row patch through a use case gives future cross-cutting concerns one seam to plug into. The named constraint appears verbatim in the database error text, so the code can tell this one violation apart and translate only it into a clean domain error.

.. CG-EXPLANATION-END id=module-header

Class ``UpdateLithoLayer`` — header
-----------------------------------

.. CG-BLOCK id=class:UpdateLithoLayer lines=39-41

.. literalinclude:: ../../../src/groundmodel/application/update_litho_layer.py
   :language: python
   :lines: 39-41
   :lineno-match:

.. CG-EXPLANATION-START id=class:UpdateLithoLayer

**What this does.** The use case that applies a partial update to one layer and commits.

**Why it is here.** A thin wrapper over the repository update; the request schema and the database check constraints are the safety net.

.. CG-EXPLANATION-END id=class:UpdateLithoLayer

Method ``UpdateLithoLayer``. ``def __init__``
---------------------------------------------

.. CG-BLOCK id=method:UpdateLithoLayer.__init__ lines=42-47

.. literalinclude:: ../../../src/groundmodel/application/update_litho_layer.py
   :language: python
   :lines: 42-47
   :lineno-match:

.. CG-EXPLANATION-START id=method:UpdateLithoLayer.__init__

**What this does.** Stores the session and builds the litho-layer repository.

**Why it is here.** The repository is the write gateway sharing the session.

.. CG-EXPLANATION-END id=method:UpdateLithoLayer.__init__

Method ``UpdateLithoLayer``. ``async def execute``
--------------------------------------------------

.. CG-BLOCK id=method:UpdateLithoLayer.execute lines=48-130

.. literalinclude:: ../../../src/groundmodel/application/update_litho_layer.py
   :language: python
   :lines: 48-130
   :lineno-match:

.. CG-EXPLANATION-START id=method:UpdateLithoLayer.execute

**What this does.** Reads the layer for a scope check, takes the body-partition locks, applies the patch, stales the 3-D solids, commits, and translates a no-overlap violation into a clean error.

**Why it is here.** The scope read is done before the lock so a not-found or out-of-model layer answers not-found without queuing behind a live writer (an IDOR guard, audit #2). The locks serialise the write with a background recompute (litho then geotech child) to avoid a deadlock. A no-overlap violation at commit means the edit would overlap an accepted sibling, which is turned into a clean domain error; any other integrity error propagates. The final refresh stops the serialiser lazy-loading the server-set update timestamp outside the async context.

.. CG-EXPLANATION-END id=method:UpdateLithoLayer.execute

