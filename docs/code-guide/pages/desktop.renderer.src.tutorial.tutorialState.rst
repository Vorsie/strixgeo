desktop.renderer.src.tutorial.tutorialState
===========================================

.. CG-PAGE source=desktop/src/renderer/src/tutorial/tutorialState.ts complete=true

*Source file:* ``desktop/src/renderer/src/tutorial/tutorialState.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialState.ts
   :language: typescript
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment. It explains that this file defines the tour's *observable state* — the handful of true/false flags and counts that a do-it step's condition reads to know the user really did the thing. It records assumption A4: every finishing condition advances on OBSERVABLE state, nothing is faked or scripted, and each fact is derived from the *shell bus* (``useShell()``) so the tour reads exactly what the app itself shows. It notes that ``deriveTutorialState`` is kept a *pure function* (it takes a plain facts object, not the live app context) so the logic can be tested without mounting the app, and that ``useTutorialState`` is the thin React wrapper around it.

**Why it is here.** The *shell bus* is the app's shared context that every stage reads its data from; a *pure function* is one whose answer depends only on its inputs, with no side effects. Reading the same facts the app renders is what makes the tour honest — it cannot claim a step is done unless the app agrees (assumption A4). Keeping the derivation pure is what lets it be unit-tested on its own.

.. CG-EXPLANATION-END id=module-header

``interface TutorialState``
---------------------------

.. CG-BLOCK id=interface:TutorialState lines=21-50

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialState.ts
   :language: typescript
   :lines: 21-50
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TutorialState

**What this does.** Lists the observed facts the tour reads: whether a project is open; counts of CPTs, boreholes, sections, formation contacts, lumped stratigraphy units, and accepted litho layers; and flags for whether a geological model exists, whether the litho 3-D solids are built, and whether a geotechnical model exists.

**Why it is here.** The comment repeats the machine's rule that any count above 0 reads as done, so counts and flags share the one satisfaction test (see the ``tutorialMachine`` page). These are precisely the facts the tour's do-it steps name in their ``done`` conditions.

.. CG-EXPLANATION-END id=interface:TutorialState

``function emptyTutorialState``
-------------------------------

.. CG-BLOCK id=function:emptyTutorialState lines=51-73

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialState.ts
   :language: typescript
   :lines: 51-73
   :lineno-match:

.. CG-EXPLANATION-START id=function:emptyTutorialState

**What this does.** Returns the first-launch state, with every flag false and every count zero.

**Why it is here.** The docstring calls this the canonical starting facts. It is also the canonical list of fact names — the catalogue test reads its keys to assert that every do-it step names a real fact, so a step that names a non-existent fact fails that test.

.. CG-EXPLANATION-END id=function:emptyTutorialState

``interface TutorialShellFacts``
--------------------------------

.. CG-BLOCK id=interface:TutorialShellFacts lines=74-112

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialState.ts
   :language: typescript
   :lines: 74-112
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TutorialShellFacts

**What this does.** Describes the narrow slice of the app's shared context the tour actually needs: the project handle, the visible CPT and borehole lists, the sections list, the geological-model slice (its active model, contacts, litho layers each carrying a status, whether solids exist, and the active geotech model), and the lifecycle slice that carries the stratigraphy-lumping snapshot. Anything it does not inspect is typed loosely (as ``unknown``).

**Why it is here.** The docstring says this is deliberately loose and structural, so the app's real shell value fits it without the tour coupling to every stage hook's full result type — and so a test can build a facts object by hand in a few lines.

.. CG-EXPLANATION-END id=interface:TutorialShellFacts

``function deriveTutorialState``
--------------------------------

.. CG-BLOCK id=function:deriveTutorialState lines=113-128

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialState.ts
   :language: typescript
   :lines: 113-128
   :lineno-match:

.. CG-EXPLANATION-START id=function:deriveTutorialState

**What this does.** Turns those shell facts into the flags and counts. It reads the lumping snapshot, then sets: project-open when the project is not null; the three counts from list lengths; geo-model-exists from a non-null active model; contact count from the contacts length; lumping count from the number of lumped keys (treating an empty map as none); accepted litho layers by counting those whose status is ``'accepted'``; and solids-built and geotech-model-exists from their handles.

**Why it is here.** One pure translation from ``what the app is holding`` to ``what a step's condition reads``. The inline comment explains one deliberate rule: an empty lumping map is not a lumping, so the lumping step only completes once at least one unit is actually lumped.

.. CG-EXPLANATION-END id=function:deriveTutorialState

