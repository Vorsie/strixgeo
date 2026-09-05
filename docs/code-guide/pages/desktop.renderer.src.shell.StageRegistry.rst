desktop.renderer.src.shell.StageRegistry
========================================

.. CG-PAGE source=desktop/src/renderer/src/shell/StageRegistry.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/StageRegistry.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageRegistry.ts
   :language: typescript
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is the single lookup table that ties every stage name to its actual stage description. The comments say so directly, and the ``import`` lines pull in the contract shape from the previous file plus the seven real stage descriptions — ``DataStage``, ``SectionsStage``, ``GeologyStage``, and so on — each living in its own folder.

**Why it is here.** The comment records the design goal: adding a new stage to the app should mean only two edits — write its description, then register it here. Gathering the wiring in one place keeps the shell itself ignorant of which particular stages exist; it just asks this table for whichever stage is active.

.. CG-EXPLANATION-END id=module-header

``const STAGE_ORDER``
---------------------

.. CG-BLOCK id=const:STAGE_ORDER lines=23-38

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageRegistry.ts
   :language: typescript
   :lines: 23-38
   :lineno-match:

.. CG-EXPLANATION-START id=const:STAGE_ORDER

**What this does.** The seven stage names again, this time as a real ordered list the running program can walk through — top to bottom — rather than only a type note. The spine reads this list to decide how many buttons to draw and in what order.

**Why it is here.** The docstring states that this order sets the top-to-bottom order of the spine buttons and must follow the engineering workflow sequence. It is written as a genuine list (not only a type) precisely because the spine needs to loop over it at run time; the matching type from the previous file guarantees every name here is a real stage.

.. CG-EXPLANATION-END id=const:STAGE_ORDER

``const STAGE_REGISTRY``
------------------------

.. CG-BLOCK id=const:STAGE_REGISTRY lines=39-47

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageRegistry.ts
   :language: typescript
   :lines: 39-47
   :lineno-match:

.. CG-EXPLANATION-START id=const:STAGE_REGISTRY

**What this does.** The lookup table itself: a *Map*, which is a labelled collection that hands back a value when given its key. Here each of the seven stage names is a key, and the value is that stage's full description. The shell looks up ``STAGE_REGISTRY.get(id)`` to fetch the description for whatever stage is active.

**Why it is here.** The docstring names the one caller: the shell reads this map by the active stage's id. A map keyed by name is the natural fit — every zone of the shell (spine button, toolbar, canvas, inspector) starts from the same single fetch, so there is one authoritative place that says "this name means this stage".

.. CG-EXPLANATION-END id=const:STAGE_REGISTRY

