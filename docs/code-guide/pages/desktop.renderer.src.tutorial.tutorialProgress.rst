desktop.renderer.src.tutorial.tutorialProgress
==============================================

.. CG-PAGE source=desktop/src/renderer/src/tutorial/tutorialProgress.ts complete=true

*Source file:* ``desktop/src/renderer/src/tutorial/tutorialProgress.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialProgress.ts
   :language: typescript
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and one import. The comment explains that this file saves and loads where the user is in the tour. It states that this is per-device screen chrome, so it lives in *localStorage*, not in the ``.strix`` project file; and that every accessor here degrades gracefully and never throws — a profile with storage disabled, or a corrupt value from an older version of the tour, must still let the app boot. It notes the same try/catch discipline as ``onboardingSeen.ts``. The import pulls in the ``TutorialProgress`` shape.

**Why it is here.** *localStorage* is a small per-user store in the browser that survives a reload. Where the user is in the tour is a screen preference, not an engineering decision, so it belongs in localStorage and never in the saved project — engineering decisions live in the ``.strix`` bundle, screen chrome lives here (memory: project_decisions_in_bundle.md; CLAUDE.md).

.. CG-EXPLANATION-END id=module-header

``const TUTORIAL_PROGRESS_KEY``
-------------------------------

.. CG-BLOCK id=const:TUTORIAL_PROGRESS_KEY lines=12-23

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialProgress.ts
   :language: typescript
   :lines: 12-23
   :lineno-match:

.. CG-EXPLANATION-START id=const:TUTORIAL_PROGRESS_KEY

**What this does.** The text name under which the progress is stored in localStorage — ``'strix.tutorial.progress.v1'``.

**Why it is here.** The docstring notes it is versioned (the ``v1``), so a future change to the tour can start from a clean key rather than choke on an old, incompatible value.

.. CG-EXPLANATION-END id=const:TUTORIAL_PROGRESS_KEY

``function isProgress``
-----------------------

.. CG-BLOCK id=function:isProgress lines=24-41

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialProgress.ts
   :language: typescript
   :lines: 24-41
   :lineno-match:

.. CG-EXPLANATION-START id=function:isProgress

**What this does.** Checks that a value read back from storage has the right shape: ``stepId`` is a string or null, and ``completed`` is an array of strings. It returns true only then.

**Why it is here.** The docstring is explicit that this validates only the SHAPE, not whether the ``stepId`` still names a real step; that later check is the machine's job (``advance`` resets an unknown id), so a change to the tour never bricks the saved value. It is the guard against a corrupt or foreign stored value.

.. CG-EXPLANATION-END id=function:isProgress

``function loadTutorialProgress``
---------------------------------

.. CG-BLOCK id=function:loadTutorialProgress lines=42-59

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialProgress.ts
   :language: typescript
   :lines: 42-59
   :lineno-match:

.. CG-EXPLANATION-START id=function:loadTutorialProgress

**What this does.** Reads the stored text, parses it from *JSON*, and returns it only if it passes the shape check; it returns ``null`` when the value is absent, unparseable, wrong-shaped, or storage is unavailable. The whole read is wrapped so any failure simply returns ``null``.

**Why it is here.** *JSON* is the text format data is stored and exchanged in. As the docstring says, a ``null`` tells the caller to seed a fresh start. The catch-all is the never-throw discipline from the header: a bad stored value must not stop the app booting.

.. CG-EXPLANATION-END id=function:loadTutorialProgress

``function saveTutorialProgress``
---------------------------------

.. CG-BLOCK id=function:saveTutorialProgress lines=60-68

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialProgress.ts
   :language: typescript
   :lines: 60-68
   :lineno-match:

.. CG-EXPLANATION-START id=function:saveTutorialProgress

**What this does.** Writes the progress to localStorage as JSON text, swallowing any failure.

**Why it is here.** The docstring explains that a lost write only means the tour will not resume next launch — never a crash mid-gesture — so it is best-effort by design.

.. CG-EXPLANATION-END id=function:saveTutorialProgress

``function clearTutorialProgress``
----------------------------------

.. CG-BLOCK id=function:clearTutorialProgress lines=69-76

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/tutorialProgress.ts
   :language: typescript
   :lines: 69-76
   :lineno-match:

.. CG-EXPLANATION-START id=function:clearTutorialProgress

**What this does.** Removes the stored progress — this is the ``Restart tutorial`` gesture — swallowing any failure.

**Why it is here.** The inline comment notes that a failed clear just leaves stale progress, which the machine's unknown-id reset already tolerates, so it is safe to ignore.

.. CG-EXPLANATION-END id=function:clearTutorialProgress

