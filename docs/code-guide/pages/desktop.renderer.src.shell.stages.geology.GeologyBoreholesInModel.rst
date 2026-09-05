desktop.renderer.src.shell.stages.geology.GeologyBoreholesInModel
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/GeologyBoreholesInModel.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/GeologyBoreholesInModel.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyBoreholesInModel.tsx
   :language: tsx
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file — the "Boreholes in model" scope roster in the geology inspector — and imports React's ``useState``, the chevron and drill icons, and the translator. The comment records the effect of a toggle: it sends a PATCH request updating the model's ``excluded_borehole_ids``, and an excluded borehole still draws its lithology on a section but no longer anchors the geological surfaces.

**Why it is here.** Extracted verbatim from the inspector (debt #201); presentation only, with the parent owning the active model and the toggle handler. A PATCH is the web request that changes part of a record on the engine. The collapse (open/closed) state moves here because it is a purely component-local concern that only this panel needs.

.. CG-EXPLANATION-END id=module-header

``interface GeologyBoreholesInModelProps``
------------------------------------------

.. CG-BLOCK id=interface:GeologyBoreholesInModelProps lines=17-51

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyBoreholesInModel.tsx
   :language: tsx
   :lines: 17-51
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeologyBoreholesInModelProps

**What this does.** Declares the roster's inputs: the boreholes to list (each an id and name — the project's visible boreholes), the ids currently excluded from the active model, a callback fired with a borehole id and its next checked state, and the translator.

**Why it is here.** The list of boreholes and the excluded set live on the shell bus and the active model, so the parent passes them in; ``included`` is the checkbox's next state (``true`` re-includes, ``false`` excludes).

.. CG-EXPLANATION-END id=interface:GeologyBoreholesInModelProps

``function GeologyBoreholesInModel``
------------------------------------

.. CG-BLOCK id=function:GeologyBoreholesInModel lines=52-114

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyBoreholesInModel.tsx
   :language: tsx
   :lines: 52-114
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeologyBoreholesInModel

**What this does.** Renders a collapsible section listing every visible borehole with a checkbox — checked means included, unchecked shows the name struck through and muted. A count of included-over-total sits in the header. Toggling a box calls ``onToggle`` with that borehole's id and its next state. It renders nothing at all when the project has no boreholes, and it owns its own open/closed state.

**Why it is here.** Excluding a borehole lets the engineer drop an unreliable log from the surface interpolation without deleting it — the log still shows its lithology on sections but stops pinning the geological contacts. This is a reversible action, so it fires immediately with no confirmation dialog.

.. CG-EXPLANATION-END id=function:GeologyBoreholesInModel

