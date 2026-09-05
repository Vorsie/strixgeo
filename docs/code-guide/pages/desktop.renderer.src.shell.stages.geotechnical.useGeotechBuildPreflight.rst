desktop.renderer.src.shell.stages.geotechnical.useGeotechBuildPreflight
=======================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geotechnical/useGeotechBuildPreflight.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geotechnical/useGeotechBuildPreflight.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-46

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/useGeotechBuildPreflight.ts
   :language: typescript
   :lines: 1-46
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file for the custom hook behind the geotech "Build model" press and the questions it asks first. A hook here is a reusable ``use…`` function that packages stateful logic for a component to share. The long docstring lays out the press's four outcomes — nothing to ask (build straight away), ask (name the tests, each one a click away), subdivide-then-build (run the safe presses, WAIT for the bands, then build), and build-without (build with those tests excluded, then say so on a chip). It pulls in the React tools, the shell context, the translator, the visit-cycling helper, the pre-flight computation and its types, the admixture helpers, the logger, the canvas's build-payload slot, and the wait-timeout constant.

**Why it is here.** It lives beside ``GeotechnicalToolbar`` rather than inside it because the toolbar is a plain drawing function while this is a four-state machine with a watchdog timer — logic that would swell the toolbar. The wait in outcome three is not optional: the subdivide presses finish by bumping a refetch signal whose fetch runs on a later screen draw, and the builder reads from a not-yet-updated list, so building on the spot would post the payload from before the press.

.. CG-EXPLANATION-END id=module-header

``type AdmixtureSelections``
----------------------------

.. CG-BLOCK id=type:AdmixtureSelections lines=47-49

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/useGeotechBuildPreflight.ts
   :language: typescript
   :lines: 47-49
   :lineno-match:

.. CG-EXPLANATION-START id=type:AdmixtureSelections

**What this does.** Names the shape of the per-unit answers while the admixture prompt is open — a map from unit id to its chosen NAD family, or nothing when still unchosen.

**Why it is here.** The prompt tracks one answer per listed unit, so a simple id-to-choice map is the natural shape, with the not-yet-chosen state carried as an explicit empty value.

.. CG-EXPLANATION-END id=type:AdmixtureSelections

``const NOTHING_EXCLUDED``
--------------------------

.. CG-BLOCK id=const:NOTHING_EXCLUDED lines=50-52

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/useGeotechBuildPreflight.ts
   :language: typescript
   :lines: 50-52
   :lineno-match:

.. CG-EXPLANATION-START id=const:NOTHING_EXCLUDED

**What this does.** A named stand-in for "exclude nothing" — the ordinary whole-model build.

**Why it is here.** Giving the empty case a name makes the call sites read as "build, excluding nothing" rather than passing a bare empty value, so the ordinary build is obvious at a glance.

.. CG-EXPLANATION-END id=const:NOTHING_EXCLUDED

``type Phase``
--------------

.. CG-BLOCK id=type:Phase lines=53-66

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/useGeotechBuildPreflight.ts
   :language: typescript
   :lines: 53-66
   :lineno-match:

.. CG-EXPLANATION-START id=type:Phase

**What this does.** Names the five places the press can be: idle (no press in flight), choosing-admixtures (the NAD-family prompt is open), asking (the unbanded-tests dialog is open), subdividing (the safe verbs are running), and awaiting-bands (the verbs are done and their bands are being waited for).

**Why it is here.** The press is a state machine, and naming each state as a distinct shape — each carrying exactly the data that state needs — keeps every transition explicit and makes an impossible combination unrepresentable. The admixture prompt is the FIRST gate, before the unbanded-tests one (owner ruling 2026-09-04).

.. CG-EXPLANATION-END id=type:Phase

``function initSelections``
---------------------------

.. CG-BLOCK id=function:initSelections lines=67-71

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/useGeotechBuildPreflight.ts
   :language: typescript
   :lines: 67-71
   :lineno-match:

.. CG-EXPLANATION-START id=function:initSelections

**What this does.** Seeds the prompt's per-unit answers from each unit's already-stored choice.

**Why it is here.** A unit answered before must show its stored choice pre-selected when the prompt re-opens (the change-my-answer path), so the initial selection is taken from each unit's persisted answer rather than starting blank.

.. CG-EXPLANATION-END id=function:initSelections

``interface UseGeotechBuildPreflightResult``
--------------------------------------------

.. CG-BLOCK id=interface:UseGeotechBuildPreflightResult lines=72-115

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/useGeotechBuildPreflight.ts
   :language: typescript
   :lines: 72-115
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseGeotechBuildPreflightResult

**What this does.** Names everything the hook hands back to the toolbar: the Build button's click handler; the unbanded-tests dialog's open state and its three actions plus the visit-test action; the list of tests the last build left out and the chip's cycle action; a busy flag; and the admixture prompt's open state, selection, per-unit pick, confirm, busy flag, re-open action, and a flag saying whether any ambiguous unit exists.

**Why it is here.** An ``interface`` is a written note about the shape of what is returned, so the toolbar knows exactly what it can render and call. Bundling the whole press — both dialogs, the chip and the busy flags — into one returned object keeps the toolbar a thin drawing function over this one hook.

.. CG-EXPLANATION-END id=interface:UseGeotechBuildPreflightResult

``function useGeotechBuildPreflight``
-------------------------------------

.. CG-BLOCK id=function:useGeotechBuildPreflight lines=116-444

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/useGeotechBuildPreflight.ts
   :language: typescript
   :lines: 116-444
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeotechBuildPreflight

**What this does.** The hook itself — it owns the press's state and every transition. It reads the visible tests, sections, models and build actions from the shell context; computes the formation scope the subdivide will classify and the admixture-ambiguous units within it; and returns the handlers. The Build press first opens the admixture prompt if any unit is unanswered, then runs the unbanded-tests pre-flight: if nothing is unbanded it builds, otherwise it opens the dialog. From the dialog, subdivide-then-build runs the safe verbs and moves to a waiting state; build-without builds with the flagged tests excluded and records them for the chip; and cancel closes. A background effect watches the waiting state, re-running the same pre-flight until the requested bands arrive (then builds) or the timeout fires (then warns that nothing was built).

**Why it is here.** Every ordering here is load-bearing. The admixture prompt is the first gate because a unit whose admixture the NAD table can read two ways must be answered before the subdivide classifies it (owner ruling 2026-09-04); only unanswered units open it, so a fully-answered model builds straight through. The subdivide-then-build path uses the fill-only verbs (subdivide without re-deriving every edge, and divide only the flagged boreholes with skip-existing) so it fills in what is missing without rewriting the engineer's existing work. The waiting effect re-runs the very same pre-flight rather than a private has-bands test, so the condition it waits for is exactly the one that stopped the press, and its timeout is bounded so a column that could never band cannot leave Build silently doing nothing. The inputs are read through refs inside the callbacks so a press always acts on what the stage shows now without every callback changing identity on each pan. Only changed admixture answers are saved on confirm, so re-opening and confirming without a change writes nothing. The one linter suppression is explained in place: the toast action is stable, so listing it would wrongly suggest a toast change should restart the wait.

.. CG-EXPLANATION-END id=function:useGeotechBuildPreflight

