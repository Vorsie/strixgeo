desktop.renderer.src.shell.stages.lithology.ModelKindPicker
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/lithology/ModelKindPicker.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/lithology/ModelKindPicker.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/ModelKindPicker.tsx
   :language: tsx
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports its tools: the ``useState`` React hook, five icons (check, layers, plus, trash, x), the shell context hook, the shared ``Modal`` and ``Button``, and the translator. The long comment explains that this control manages the lithostratigraphic model lifecycle — pick which litho model is active and create a new one under the active geological parent — and records the UX-review decisions behind its look.

**Why it is here.** React is the library that builds the screen from small functions; a ``hook`` is a ``use...`` function that lets a component use a React feature. The comment records the scope decision: the geological model is the single v1 backbone shown read-only elsewhere, and geotechnical models are a later phase not surfaced here — the project does not build UI for a kind it cannot yet populate. It also records that the engine enforces the invariants (every litho model has a geological parent, one active model per kind), so this is a thin assisted control over them, and that the picker is drawn as its own full-weight row so the two ground-model axes read as peers.

.. CG-EXPLANATION-END id=module-header

``function ModelKindPicker``
----------------------------

.. CG-BLOCK id=function:ModelKindPicker lines=44-278

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/ModelKindPicker.tsx
   :language: tsx
   :lines: 44-278
   :lineno-match:

.. CG-EXPLANATION-START id=function:ModelKindPicker

**What this does.** The picker component. It holds small pieces of state for the create-new flow (a draft name and a "creating" flag), for the busy guards on create/activate/delete, and for the delete-confirm dialog. It reads the models and handlers from the shell and returns nothing when there is no geological backbone. Otherwise it draws a compact row: a layers icon and a "Model" label, then either an inline name-entry form (while creating), or a dropdown of existing litho models with a "New" button and a delete button (when models exist), or a single dashed "create one to pick" call-to-action (when none exist). It also carries an irreversible delete-confirm dialog.

**Why it is here.** It returns nothing until a geological backbone exists because a litho model cannot be created without a geological parent — an invariant the engine enforces. The activation and create paths carry busy guards so a double-click cannot fire two calls. The empty state is an actionable call-to-action rather than a muted "none yet" because this is the first-run moment where the engineer forms the mental model that Litho is a second, separate ground-model axis he must create before picking contacts on sections. The delete-confirm dialog focuses Cancel by default and names the destructive action on its button, because deleting a model is irreversible (see ``docs/ux.md``); if the delete fails the dialog stays open, because the handler has already toasted the reason and the engineer needs to see it did not complete.

.. CG-EXPLANATION-END id=function:ModelKindPicker

