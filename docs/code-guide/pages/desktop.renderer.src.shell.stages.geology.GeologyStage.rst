desktop.renderer.src.shell.stages.geology.GeologyStage
======================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/GeologyStage.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/GeologyStage.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyStage.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the geology stage descriptor file and imports its parts: the mountain icon, the stage-descriptor types, the shell hook, the translator, the geological-formation filter, and the three stage components (canvas, toolbar, inspector).

**Why it is here.** The app is a left spine of stages (Data, Stratigraphy, Lithology, Geotechnical, Sections, Parameters, Export). Each stage is described by one descriptor object that names its canvas, toolbar and inspector; this file assembles the geology descriptor. Stratigraphy is the code name for the geological model, so its folder is ``geology/``.

.. CG-EXPLANATION-END id=module-header

``function useGeologyStageSummary``
-----------------------------------

.. CG-BLOCK id=function:useGeologyStageSummary lines=26-43

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyStage.ts
   :language: typescript
   :lines: 26-43
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeologyStageSummary

**What this does.** A hook computing the small summary the geology stage shows on the spine: it counts the geological-kind formations, reads the stale-surface count, builds a label, and picks a badge — an amber "N stale" badge when surfaces are stale, otherwise the plain formation count.

**Why it is here.** It filters to geological-kind formations because the shell's visible-formation list also holds lithology and geotech rows; without the filter the badge counted all 100-plus formations instead of the handful of actual geological units (dogfeed 2026-06-30). The amber badge flags that a Build is needed to refresh the surfaces.

.. CG-EXPLANATION-END id=function:useGeologyStageSummary

``const GeologyStage``
----------------------

.. CG-BLOCK id=const:GeologyStage lines=44-53

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyStage.ts
   :language: typescript
   :lines: 44-53
   :lineno-match:

.. CG-EXPLANATION-START id=const:GeologyStage

**What this does.** The stage descriptor object itself: the stage id, the mountain icon, the spine label "Geology", the summary hook above, and the canvas, toolbar and inspector components.

**Why it is here.** The shell renders each stage entirely from its descriptor, so this object is the geology stage's single registration point in the left spine.

.. CG-EXPLANATION-END id=const:GeologyStage

``default default``
-------------------

.. CG-BLOCK id=default:default lines=54-54

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyStage.ts
   :language: typescript
   :lines: 54-54
   :lineno-match:

.. CG-EXPLANATION-START id=default:default

**What this does.** Exports the descriptor as the module's default value.

**Why it is here.** The shell imports each stage by its module default, so exporting the descriptor here is what lets the spine pick up the geology stage.

.. CG-EXPLANATION-END id=default:default

