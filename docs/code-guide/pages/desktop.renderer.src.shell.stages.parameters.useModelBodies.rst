desktop.renderer.src.shell.stages.parameters.useModelBodies
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/useModelBodies.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/useModelBodies.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/useModelBodies.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file for a custom hook that fetches one model's body roster — the per-body metadata (name, ordinal, and the crossed-formation list) — from the engine, importing React's hooks, the API client and the logger.

**Why it is here.** The comment explains why this is its own hook rather than shell state: every consumer needs the roster only as label or annotation cosmetics layered over data it already holds (the grouping itself comes from the layers' ``body_id``), each is a separate no-props stage slot, and each fetch is one small request keyed by project, model and recompute nonce. The consumer set has grown beyond Parameters — the sections canvas jump rosters and the geotechnical inspector's subtitle use it too. A missing or failed roster degrades to id-prefix labels, never a blocked pane.

.. CG-EXPLANATION-END id=module-header

``const EMPTY``
---------------

.. CG-BLOCK id=const:EMPTY lines=22-42

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/useModelBodies.ts
   :language: typescript
   :lines: 22-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:EMPTY

**What this does.** A single shared empty map from body id to roster row.

**Why it is here.** One frozen empty map is reused for every no-data case so the hook returns a stable object rather than a new empty map each render, keeping watchers from seeing a spurious change.

.. CG-EXPLANATION-END id=const:EMPTY

``function useModelBodies``
---------------------------

.. CG-BLOCK id=function:useModelBodies lines=43-76

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/useModelBodies.ts
   :language: typescript
   :lines: 43-76
   :lineno-match:

.. CG-EXPLANATION-START id=function:useModelBodies

**What this does.** The hook. Given a project id, a model id (litho or geotech) and a refetch key, it holds a ``body id → roster row`` map in state; its after-render effect fetches the model's bodies and builds the map — clearing to empty when either id is missing — cancels a stale fetch when its inputs change, and on failure logs a warning and falls back to empty. It returns the map.

**Why it is here.** The ``cancelled`` flag in the effect's cleanup discards a response that lands after the inputs moved on. The refetch key is the axis's body-recompute nonce, so labels follow a recompute. A scope with no active model has no bodies to label, so a null model id fetches nothing. Failing to empty (with a named warning, not a toast) is deliberate: the pane must stay usable, and the label helper already knows how to show an id prefix when a body is missing.

.. CG-EXPLANATION-END id=function:useModelBodies

