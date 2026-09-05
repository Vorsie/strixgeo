desktop.renderer.src.shell.stages.geotechnical.GeotechnicalStage
================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalStage.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalStage.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalStage.ts
   :language: typescript
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the small file that describes the Geotechnical stage to the app's staged shell — the left spine of stages. The comment records which pieces the stage is made of: the canvas is the 3-D room for the geotech model, the inspector renders the NAD packing-unit roster, and the toolbar carries the 3-D verbs ("Build model", "Reset camera"), while the 2-D editing verbs ("Subdivide all bodies", "Correlate packing") stay on the Sections stage's toolbar. It pulls in the flask icon and the three stage components.

**Why it is here.** The app is built as a spine of stages, each supplying a canvas, a toolbar and an optional inspector; this descriptor is how the Geotechnical stage plugs in. The comment records the owner's 2026-08-26 ruling that retired the stage-local 2-D/3-D toggle so the geotech stages mirror the litho ones — Sections is 2-D, Lithology and Geotechnical are the 3-D rooms.

.. CG-EXPLANATION-END id=module-header

``function useGeotechnicalStageSummary``
----------------------------------------

.. CG-BLOCK id=function:useGeotechnicalStageSummary lines=29-32

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalStage.ts
   :language: typescript
   :lines: 29-32
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeotechnicalStageSummary

**What this does.** Returns the little summary the spine shows next to the stage's name — here a fixed label "Geotechnical units" with no count badge.

**Why it is here.** It is a placeholder: the comment notes it will report a real unit count once Phase 5 lands, so for now it states the label without a number rather than showing a figure it cannot yet compute.

.. CG-EXPLANATION-END id=function:useGeotechnicalStageSummary

``const GeotechnicalStage``
---------------------------

.. CG-BLOCK id=const:GeotechnicalStage lines=33-42

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalStage.ts
   :language: typescript
   :lines: 33-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:GeotechnicalStage

**What this does.** Bundles the stage's parts into one descriptor object: its id, its spine icon and label ("Geotech"), the summary function above, and the canvas, toolbar and inspector components.

**Why it is here.** The shell reads one descriptor per stage to know what to mount where, so gathering the id, icon, label, summary and three components in a single object is how this stage registers itself with the spine.

.. CG-EXPLANATION-END id=const:GeotechnicalStage

``default default``
-------------------

.. CG-BLOCK id=default:default lines=43-43

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalStage.ts
   :language: typescript
   :lines: 43-43
   :lineno-match:

.. CG-EXPLANATION-START id=default:default

**What this does.** Makes the stage descriptor the file's default export, so other files can import it by name.

**Why it is here.** Each stage descriptor is imported once by the shell's stage registry; exporting it as the default is the ordinary way a single-value module hands out its one value.

.. CG-EXPLANATION-END id=default:default

