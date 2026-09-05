desktop.renderer.src.tutorial.TutorialOverlay
=============================================

.. CG-PAGE source=desktop/src/renderer/src/tutorial/TutorialOverlay.tsx complete=true

*Source file:* ``desktop/src/renderer/src/tutorial/TutorialOverlay.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/TutorialOverlay.tsx
   :language: tsx
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the imports. The comment explains that this *overlay* draws the spotlight plus the coach card. It is mounted once by ``App`` inside the shell provider (so it can read the shell bus), owns the progress state, advances it on observable state, and draws nothing while inactive. The dim layer is set to ``pointer-events: none`` so the user can still click anything — a tour that fights the app is worse than none (assumption A2). It records the off-screen fallback: when the target control is not visible it highlights the owning stage tab (if that tab is not already active), and failing that it docks the card bottom-right. The imports pull in React hooks, the *portal* function, and every tutorial piece — the state hook, the anchor hook, the catalogue, the machine's functions, progress load/save, the placement maths, and the card.

**Why it is here.** An *overlay* is a drawing layer painted on top of the whole app; a *portal* is React drawing into a different part of the page. This is the one place all the tour's pieces are wired to the screen. Keeping the dim layer non-blocking is the explicit A2 stance recorded in the comment: the tour guides but never blocks the app underneath.

.. CG-EXPLANATION-END id=module-header

``interface TutorialOverlayProps``
----------------------------------

.. CG-BLOCK id=interface:TutorialOverlayProps lines=36-50

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/TutorialOverlay.tsx
   :language: tsx
   :lines: 36-50
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TutorialOverlayProps

**What this does.** The overlay's two inputs: ``active`` (whether the tour is running) and ``onExit`` (called when the user skips the tour or reaches the end).

**Why it is here.** The docstrings make the split clear: the parent (``App``) owns whether the tour is on and what happens when it ends, and the overlay just reports ``I'm done`` back through ``onExit``.

.. CG-EXPLANATION-END id=interface:TutorialOverlayProps

``function openExternalUrl``
----------------------------

.. CG-BLOCK id=function:openExternalUrl lines=51-55

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/TutorialOverlay.tsx
   :language: tsx
   :lines: 51-55
   :lineno-match:

.. CG-EXPLANATION-START id=function:openExternalUrl

**What this does.** Opens a URL in the system browser by calling ``window.open`` with the ``noopener,noreferrer`` safety options.

**Why it is here.** The comment explains the mechanism: the main process denies ``window.open`` a real pop-up window and instead hands the trusted URL to the operating system's browser (``shell.openExternal``), so no new bridge call is needed. The app stays offline-first and clip videos are never bundled — this simply reuses the app's existing external-link path.

.. CG-EXPLANATION-END id=function:openExternalUrl

``function Spotlight``
----------------------

.. CG-BLOCK id=function:Spotlight lines=56-99

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/TutorialOverlay.tsx
   :language: tsx
   :lines: 56-99
   :lineno-match:

.. CG-EXPLANATION-START id=function:Spotlight

**What this does.** Draws the dim overlay with a clear cut-out around the spotlighted control. Given the control's rectangle it computes a slightly padded hole; it then draws an *SVG* covering the whole window, filled with a semi-transparent dark colour, using a *mask* so the hole area is left clear, and outlines the hole in the accent colour. With no rectangle it dims the whole window and draws no hole.

**Why it is here.** *SVG* is a vector-drawing format; a *mask* is how the dark layer gets a clear hole punched in it so the highlighted control shows through undimmed. It is marked ``aria-hidden`` (decoration, not read aloud) and, sitting inside the pointer-events-none layer, it never blocks a click.

.. CG-EXPLANATION-END id=function:Spotlight

``function TutorialOverlay``
----------------------------

.. CG-BLOCK id=function:TutorialOverlay lines=100-208

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/TutorialOverlay.tsx
   :language: tsx
   :lines: 100-208
   :lineno-match:

.. CG-EXPLANATION-START id=function:TutorialOverlay

**What this does.** The overlay component. It reads the observable tour state, keeps the progress in remembered state (seeded from the saved value or a fresh start), and tracks the viewport size. Several effects run: one reloads progress whenever the tour is activated (a finished run starts over, a mid-way run resumes); one auto-advances the progress whenever the observed facts change, saving the new progress; one keeps the viewport size current on window resize; and one calls ``onExit`` once the run finishes. It resolves the current step, measures that control's rectangle, and — when the control is off screen and the owning stage tab is not already active — falls back to measuring that stage tab instead. Four click callbacks wrap the machine's back / next / skip-step / skip-tutorial and save the result. If the tour is inactive or there is no step it draws nothing; otherwise it computes the card placement and draws, through a portal into the page body, the dim/spotlight layer plus the coach card wired with all its props (which step, chapter title, progress numbers, video URL, placement, the explain / last / off-screen / has-tab flags, and the four callbacks).

**Why it is here.** Every hook sits above the early ``return null`` on purpose — React's *rules of hooks* require the same hooks in the same order on every redraw. The auto-advance step depends on the value-stable state from ``useTutorialState``, which is why a fresh object every redraw would loop; advancing only on observed facts is assumption A4, nothing faked. Drawing through a *portal* into ``document.body`` lifts the overlay above the whole app, so the dim and spotlight cover everything regardless of where the overlay sits in the component tree. The primary-anchor-then-stage-tab step is the off-screen fallback recorded in the header.

.. CG-EXPLANATION-END id=function:TutorialOverlay

