desktop.renderer.src.shell.stages.lithology.LithoBoreholesInModel
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/lithology/LithoBoreholesInModel.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/lithology/LithoBoreholesInModel.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoBoreholesInModel.tsx
   :language: tsx
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports its tools: the ``useState`` React hook, three small icons (a down chevron, a right chevron, a drill), and the translator type. The comment at the top explains that this is the "Boreholes in model" roster — the in-app gesture that lets the engineer newly exclude a borehole from the litho build.

**Why it is here.** React is the library that builds the screen from small functions; a ``hook`` is a ``use...`` function that lets one of those functions use a React feature. The 3-D litho model is built honouring boreholes — an included borehole pins the labelling, an excluded one is left out — so the engineer needs a way to take a borehole out of a model's build. This roster is that control (debt #65). It deliberately mirrors the geological stage's identical checkbox roster so the two ground-model axes behave the same. The comment records that toggling is a reversible, project-local action: it fires immediately with no confirmation dialog, and the parent registers the Ctrl+Z undo and a confirmation toast — this component only draws the list; the parent owns the model and the toggle handler.

.. CG-EXPLANATION-END id=module-header

``interface LithoBoreholesInModelProps``
----------------------------------------

.. CG-BLOCK id=interface:LithoBoreholesInModelProps lines=23-58

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoBoreholesInModel.tsx
   :language: tsx
   :lines: 23-58
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoBoreholesInModelProps

**What this does.** Describes the inputs the roster expects: the ``boreholes`` to list (each an id and a name), the ``excludedBoreholeIds`` for the active litho model, an ``onToggle`` callback fired with a borehole id and its next checked state, and the active-language translator ``t``. It also carries the numpy-style docstring describing each input and the return value.

**Why it is here.** ``props`` are the inputs a parent hands a component; naming their shape makes the contract explicit. The docstring spells out that ``included`` is the checkbox's next state — ``true`` re-includes the borehole, ``false`` excludes it — so the single handler covers both directions without a second entry point. The comment notes the component returns nothing when the project has no boreholes, because there is nothing to scope.

.. CG-EXPLANATION-END id=interface:LithoBoreholesInModelProps

``function LithoBoreholesInModel``
----------------------------------

.. CG-BLOCK id=function:LithoBoreholesInModel lines=59-139

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoBoreholesInModel.tsx
   :language: tsx
   :lines: 59-139
   :lineno-match:

.. CG-EXPLANATION-START id=function:LithoBoreholesInModel

**What this does.** Draws the roster. It keeps one piece of ``state`` — whether the list is expanded — starting collapsed. It returns nothing when there are no boreholes. Otherwise it builds a set of the excluded ids, counts how many are still included, and draws a header button showing an included-over-total count that folds the list open and closed. When open it shows a one-line hint and a scrollable checkbox list: each borehole row is checked when included and struck through with muted text when excluded, and toggling a checkbox calls ``onToggle`` with that borehole's next state.

**Why it is here.** It starts collapsed to match the geological roster and keep the panel tidy; the separate excluded-boreholes callout below surfaces the exceptions even while this stays folded. Both toggle directions fire immediately because a membership change is reversible and project-local (see ``docs/ux.md``) — the undo path is re-checking the box, the Ctrl+Z stack, or the "Include again" list. The struck-through styling gives the excluded rows a visible state without a second control.

.. CG-EXPLANATION-END id=function:LithoBoreholesInModel

