desktop.renderer.src.components.sections.partitionGhostHandles
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/partitionGhostHandles.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/partitionGhostHandles.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionGhostHandles.ts
   :language: typescript
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A pure detector that finds the DEAD, or ghost, reshape handles in a partition: tips the tool would draw a grab affordance for but which the engine does not actually let the engineer move. It takes the partition plus a compute-the-fill callback and returns the set of dead handles.

**Why it is here.** Owner ruling 2026-07-22, verbatim: hide them, if they were merged into one body and deleted afterwards then they are GHOST CONTACTS, modelling artefacts with no real meaning. The rule is that every handle the tool renders MUST reshape; a tip whose override the engine ignores (its footprint does not budge) gets no grab affordance. The header also explains why the earlier ``unroutableBodies`` approach missed these (it only looked at bodies that already had a stored node, and a fresh first-grab has none) and notes that the fill engine is injected as a parameter so the probe never routes through the retired v1 engine.

.. CG-EXPLANATION-END id=module-header

``type ComputePartition``
-------------------------

.. CG-BLOCK id=type:ComputePartition lines=40-59

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionGhostHandles.ts
   :language: typescript
   :lines: 40-59
   :lineno-match:

.. CG-EXPLANATION-START id=type:ComputePartition

**What this does.** The signature of the fill-computing function this detector is handed: it takes the columns, the approved correlation edges, optional apex overrides, and the along-metres, and returns the fill regions.

**Why it is here.** Injecting the engine as a parameter keeps the detector engine-agnostic; the tests pass the raw v2 engine, and the overlay passes the active selector.

.. CG-EXPLANATION-END id=type:ComputePartition

``function bodyFootprintSig``
-----------------------------

.. CG-BLOCK id=function:bodyFootprintSig lines=60-73

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionGhostHandles.ts
   :language: typescript
   :lines: 60-73
   :lineno-match:

.. CG-EXPLANATION-START id=function:bodyFootprintSig

**What this does.** Builds a stable text signature of one body's polygon or polygons in one gap, made of the kind plus its fraction and elevation points rounded and sorted, so two fill results can be compared to answer did this body's shape change.

**Why it is here.** Rounding the numbers to four decimals means a harmless re-clamp that returns the exact same shape reads as unchanged; the signature is the byte-static test for the-override-moved-nothing.

.. CG-EXPLANATION-END id=function:bodyFootprintSig

``function interiorApexFraction``
---------------------------------

.. CG-BLOCK id=function:interiorApexFraction lines=74-119

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionGhostHandles.ts
   :language: typescript
   :lines: 74-119
   :lineno-match:

.. CG-EXPLANATION-START id=function:interiorApexFraction

**What this does.** Returns the fraction of the widest-inset tip in a region, which is the apex the tool draws a handle at. The long comment that follows describes the ghost-handle probe of the next function.

**Why it is here.** The handle is drawn at the vertex furthest from either column edge, which is the visible apex the engineer would grab.

.. CG-EXPLANATION-END id=function:interiorApexFraction

``function detectDeadHandleBodies``
-----------------------------------

.. CG-BLOCK id=function:detectDeadHandleBodies lines=120-147

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/partitionGhostHandles.ts
   :language: typescript
   :lines: 120-147
   :lineno-match:

.. CG-EXPLANATION-START id=function:detectDeadHandleBodies

**What this does.** For every apex-shapeable region it feeds a single moderate apex nudge, exactly as the overlay's reshape would, re-runs the fill, and compares the body's footprint signature before and after; if it did not move, the handle is dead. It returns the set of ``gapIndex:bodyId`` keys of every dead handle.

**Why it is here.** A ghost tip, which is a merge-welded interior seam of one continuous same-lithology band that the engine deliberately suppresses, does not move under the nudge, so it should carry no handle; a live enclosed lens or bracketed onlap reshapes and keeps its handle. Each probe costs one full fill computation per shapeable region, which is exactly why the caller memoises the result per topology rather than running it every frame.

.. CG-EXPLANATION-END id=function:detectDeadHandleBodies

