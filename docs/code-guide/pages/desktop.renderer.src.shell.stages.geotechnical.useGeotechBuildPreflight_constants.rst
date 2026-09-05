desktop.renderer.src.shell.stages.geotechnical.useGeotechBuildPreflight_constants
=================================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geotechnical/useGeotechBuildPreflight_constants.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geotechnical/useGeotechBuildPreflight_constants.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/useGeotechBuildPreflight_constants.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the tiny file holding the constants for the geotech Build pre-flight's state machine.

**Why it is here.** The pre-flight hook keeps its tuneable numbers in a separate constants file, following the project convention that module-level constants live beside the code that uses them rather than at the top of the logic file.

.. CG-EXPLANATION-END id=module-header

``const GEOTECH_BAND_WAIT_MS``
------------------------------

.. CG-BLOCK id=const:GEOTECH_BAND_WAIT_MS lines=24-24

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/useGeotechBuildPreflight_constants.ts
   :language: typescript
   :lines: 24-24
   :lineno-match:

.. CG-EXPLANATION-START id=const:GEOTECH_BAND_WAIT_MS

**What this does.** Sets to 15 seconds how long "Subdivide them & build" waits for the bands it just asked for to reach the screen before it gives up and says nothing was built.

**Why it is here.** A wait is needed at all because the subdivide press finishes by bumping a refetch signal whose data fetch runs on a later screen draw — so the fresh bands are provably not yet in hand when the press returns, and the builder reads from that not-yet-updated list; the build therefore waits for the model to catch up rather than predicting it (the defer-until-loaded rule). It is bounded because a column the press could not band would otherwise leave the wait running forever and the Build button silently doing nothing; 15 seconds is far longer than any single list fetch takes yet short enough that a stall is reported while the engineer is still looking at the screen.

.. CG-EXPLANATION-END id=const:GEOTECH_BAND_WAIT_MS

