desktop.renderer.src.tutorial.tutorialMachine
=============================================

.. CG-PAGE source=desktop/src/renderer/src/tutorial/tutorialMachine.ts complete=true

*Source file:* ``desktop/src/renderer/src/tutorial/tutorialMachine.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialMachine.ts
   :language: typescript
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment and its two imports. The comment explains that this file is the *step machine* for the guided tour: it holds no on-screen drawing and no saved data of its own. It is a set of small functions that each take the current ``progress`` plus a snapshot of what the user has done, and work out what the next ``progress`` should be. It then names the three files it works alongside — ``tutorialProgress.ts`` writes the result to disk, ``useTutorialState`` supplies the snapshot of facts, and ``TutorialOverlay`` draws the current step. The two imports pull in data-shape descriptions only (``CatalogueStep`` and ``TutorialState``), no running code.

**Why it is here.** This is a *state machine* — a small bookkeeper that is always on exactly one named step and moves to another only by well-defined rules. A state machine is easiest to trust when it is kept apart from drawing and storage, so this file deliberately owns neither. The comment records that every function takes the step list as a parameter rather than reaching for a fixed one, which keeps the machine *catalogue-agnostic*: the automated tests can feed it a small made-up list of steps and check every rule exhaustively.

.. CG-EXPLANATION-END id=module-header

``interface TutorialProgress``
------------------------------

.. CG-BLOCK id=interface:TutorialProgress lines=17-36

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialMachine.ts
   :language: typescript
   :lines: 17-36
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TutorialProgress

**What this does.** Describes the one small piece of information the tour tracks as it runs: ``stepId`` (the id of the step the user is currently on, or the special value ``null`` meaning the tour is finished) and ``completed`` (the list of step ids already done). An *interface* is just a note listing the fields a value carries; it is checked before the app runs and then disappears.

**Why it is here.** The comment calls this a *serialisable* pair, meaning it is plain data that can be written to disk as text and read back later — which is exactly what lets the tour resume between launches (see the ``tutorialProgress`` page). The rule that ``stepId === null`` means finished is the single fact every other function in this file leans on to know when to stop.

.. CG-EXPLANATION-END id=interface:TutorialProgress

``function isSatisfied``
------------------------

.. CG-BLOCK id=function:isSatisfied lines=37-47

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialMachine.ts
   :language: typescript
   :lines: 37-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:isSatisfied

**What this does.** A small helper that answers one yes/no question: is this step's finishing condition met? There are two kinds of step. An *explain step* (its ``done`` field is the word ``'next'``) is finished only once the user has clicked Next — that is, once its id is already in the completed set. A *do-it step* (its ``done`` field names an observable fact) is finished when that fact is *truthy*: the comment notes that a count of 0 reads as not-done and any count above 0 reads as done, so a numeric count and a true/false flag are judged by the same one rule.

**Why it is here.** Two step kinds resolved by one test keeps the machine simple — it never has to special-case ``is this a count or a flag?``. As the docstring points out, ``Boolean(0)`` being ``false`` is the trick that unifies a ``count > 0`` check and a plain flag under a single line of code.

.. CG-EXPLANATION-END id=function:isSatisfied

``function initialProgress``
----------------------------

.. CG-BLOCK id=function:initialProgress lines=48-52

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialMachine.ts
   :language: typescript
   :lines: 48-52
   :lineno-match:

.. CG-EXPLANATION-START id=function:initialProgress

**What this does.** Returns the starting progress: the id of the very first step in the list, with nothing yet completed. If the step list is somehow empty it returns a finished progress instead (``stepId`` null).

**Why it is here.** The docstring calls this the fresh-start value. Having one place that defines ``the beginning`` means first launch and the Restart gesture always agree on where the tour starts.

.. CG-EXPLANATION-END id=function:initialProgress

``function restart``
--------------------

.. CG-BLOCK id=function:restart lines=53-57

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialMachine.ts
   :language: typescript
   :lines: 53-57
   :lineno-match:

.. CG-EXPLANATION-START id=function:restart

**What this does.** Simply another name for ``initialProgress`` — used by the ``Restart tutorial`` menu gesture.

**Why it is here.** The docstring records it as an alias. Giving the same behaviour a second, intention-revealing name lets the calling code read ``restart(...)`` where a restart is meant, rather than the less obvious ``initialProgress(...)``.

.. CG-EXPLANATION-END id=function:restart

``function isFinished``
-----------------------

.. CG-BLOCK id=function:isFinished lines=58-68

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialMachine.ts
   :language: typescript
   :lines: 58-68
   :lineno-match:

.. CG-EXPLANATION-START id=function:isFinished

**What this does.** Returns true when the tour has run past its last step — that is, when ``stepId`` is ``null``.

**Why it is here.** One named test for ``are we done?``, reused by the overlay to know when to close and by the reload logic to start a finished run over from the top.

.. CG-EXPLANATION-END id=function:isFinished

``function currentStep``
------------------------

.. CG-BLOCK id=function:currentStep lines=69-90

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialMachine.ts
   :language: typescript
   :lines: 69-90
   :lineno-match:

.. CG-EXPLANATION-START id=function:currentStep

**What this does.** Given the saved progress and the step list, finds and returns the actual step record the user is on. Returns ``null`` when the tour is finished, or when the saved id no longer matches any step in the list.

**Why it is here.** The saved progress holds only an id (a short piece of text); this turns that id back into the full step so the overlay can read its anchor and its wording. Returning ``null`` on an unknown id (as the docstring notes) keeps a stale save from crashing the screen.

.. CG-EXPLANATION-END id=function:currentStep

``function advance``
--------------------

.. CG-BLOCK id=function:advance lines=91-135

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialMachine.ts
   :language: typescript
   :lines: 91-135
   :lineno-match:

.. CG-EXPLANATION-START id=function:advance

**What this does.** The auto-advance engine — the busiest function here. Given the current progress, a snapshot of observable facts, and the step list, it walks forward from the current step: it completes every step whose condition is now met and steps over any explain steps already done, and it stops at the first step that still needs the user (an unfinished do-it step, or an explain step still waiting for Next). In order: if the tour is already finished it returns unchanged; if the list is empty it returns finished. It finds the position of the current step; if that id is unknown (a save left over from an older version of the tour) it resets to the first step and clears the completed set. Then it loops — for an explain step, if already completed it moves on, otherwise it stops there; for a do-it step, if its fact is satisfied it marks it done and moves on, otherwise it stops. Finally it records the id it stopped on (or ``null`` if it walked off the end) together with the updated completed list.

**Why it is here.** This is where the tour's core promise lives: it advances only on OBSERVABLE state, nothing is faked or scripted (assumption A4, recorded on the ``tutorialState`` page). Because it re-runs every time the observed facts change, the moment the engineer actually creates a section or imports a CPT the tour notices and moves itself along. The unknown-id reset is what lets the step list change between app versions without bricking a saved tour — the storage layer checks only the shape, and the meaning is settled here (see the ``tutorialProgress`` page).

.. CG-EXPLANATION-END id=function:advance

``function completeStep``
-------------------------

.. CG-BLOCK id=function:completeStep lines=136-157

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialMachine.ts
   :language: typescript
   :lines: 136-157
   :lineno-match:

.. CG-EXPLANATION-START id=function:completeStep

**What this does.** The Next / Finish button. It marks the current step as completed so it never re-arms, then moves to the next step — or to finished if it was the last. If the saved id is unknown it restarts. The id is only added to the completed list if it is not already there.

**Why it is here.** As the docstring says, marking the step completed is what stops an explain step from re-triggering, while moving to the next id is the ordinary forward motion the user drives by clicking Next.

.. CG-EXPLANATION-END id=function:completeStep

``function skipStep``
---------------------

.. CG-BLOCK id=function:skipStep lines=158-176

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialMachine.ts
   :language: typescript
   :lines: 158-176
   :lineno-match:

.. CG-EXPLANATION-START id=function:skipStep

**What this does.** The ``Skip step`` button. It moves forward to the next step WITHOUT marking the current one completed, so a later Back still re-shows it. It restarts on an unknown id.

**Why it is here.** The docstring spells out the deliberate difference from Next: skip leaves the step incomplete on purpose, so the user can come back to it, whereas Next marks it done for good.

.. CG-EXPLANATION-END id=function:skipStep

``function back``
-----------------

.. CG-BLOCK id=function:back lines=177-190

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialMachine.ts
   :language: typescript
   :lines: 177-190
   :lineno-match:

.. CG-EXPLANATION-START id=function:back

**What this does.** The Back button. It moves to the previous step. It clamps at the first step (it cannot go before it), and from a finished tour it returns to the last step. The ``completed`` list is left untouched.

**Why it is here.** As the docstring notes, leaving ``completed`` untouched means stepping back to review something does not undo what the user has already achieved.

.. CG-EXPLANATION-END id=function:back

``interface ChapterProgress``
-----------------------------

.. CG-BLOCK id=interface:ChapterProgress lines=191-208

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialMachine.ts
   :language: typescript
   :lines: 191-208
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ChapterProgress

**What this does.** Describes the four numbers shown in the little ``chapter i of n, step j of m`` strip on the coach card: the chapter's 1-based position among the chapters that have steps, how many such chapters there are, the step's 1-based position within its chapter, and how many steps that chapter holds.

**Why it is here.** A named shape for the progress strip, so the function that computes these numbers and the card that displays them agree on exactly which fields exist.

.. CG-EXPLANATION-END id=interface:ChapterProgress

``function chapterProgress``
----------------------------

.. CG-BLOCK id=function:chapterProgress lines=209-221

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialMachine.ts
   :language: typescript
   :lines: 209-221
   :lineno-match:

.. CG-EXPLANATION-START id=function:chapterProgress

**What this does.** Computes those four numbers for a given step. It gathers the distinct chapter numbers that actually have steps and sorts them, filters the steps belonging to this step's chapter, and returns the chapter's position among the chapters, the total chapter count, the step's position within its chapter, and the count of steps in that chapter.

**Why it is here.** The docstring calls this turning a step into its ``you are here`` coordinates for the strip. Counting only chapters that actually have steps keeps the strip honest while some later chapters are still skeletons.

.. CG-EXPLANATION-END id=function:chapterProgress

