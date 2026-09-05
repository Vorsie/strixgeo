desktop.renderer.src.components.onboarding.OnboardingOverlay
============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/onboarding/OnboardingOverlay.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/onboarding/OnboardingOverlay.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/components/onboarding/OnboardingOverlay.tsx
   :language: tsx
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment and the imports for the first-launch onboarding overlay — the front door a brand-new user meets. It walks through a welcome screen, then a choice (load a worked sample project, or start from scratch), then an offer to begin the hands-on guided tutorial. It imports the Modal and Button pieces and the translator hook. (An overlay is a panel that layers over the rest of the interface; React is the library that builds the interface from small reusable pieces called components, whose HTML-like markup is JSX.)

**Why it is here.** The comment cites owner ruling 24 (CLAUDE.local.md): onboarding is BOTH a worked sample AND a skippable tour. It records that the old six-slide tour, which merely NAMED the stages, is gone (spec 2026-09-02-guided-tutorial-design.md), replaced by a tutorial that highlights each real control on the user's own project. The overlay layers over the WelcomeScreen, is gated by ``App`` on a persisted "seen" flag (``utils/onboardingSeen.ts``) so it appears only once per device, and is re-openable from Help. It is honest that the flow, the seen-gate and the wording are real while the "Load sample" DATA is still a placeholder (debt #93).

.. CG-EXPLANATION-END id=module-header

``type Phase``
--------------

.. CG-BLOCK id=type:Phase lines=26-28

.. literalinclude:: ../../../desktop/src/renderer/src/components/onboarding/OnboardingOverlay.tsx
   :language: tsx
   :lines: 26-28
   :lineno-match:

.. CG-EXPLANATION-START id=type:Phase

**What this does.** A type naming the three screens of the flow: ``welcome``, ``choose`` and ``start``. (A type is a note describing which values are allowed.)

**Why it is here.** Writing the screens as a closed list means the code can only ever be on one of the three real screens, and a misspelt screen name is caught by the build rather than by a confused user.

.. CG-EXPLANATION-END id=type:Phase

``type StartIntent``
--------------------

.. CG-BLOCK id=type:StartIntent lines=29-30

.. literalinclude:: ../../../desktop/src/renderer/src/components/onboarding/OnboardingOverlay.tsx
   :language: tsx
   :lines: 29-30
   :lineno-match:

.. CG-EXPLANATION-START id=type:StartIntent

**What this does.** A type naming what the user picked on the choose screen — ``sample``, ``scratch``, or nothing chosen yet.

**Why it is here.** The comment says the choice is remembered here and executed only when the flow finishes, so the user can still go Back and change their mind before anything actually happens.

.. CG-EXPLANATION-END id=type:StartIntent

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=31-64

.. literalinclude:: ../../../desktop/src/renderer/src/components/onboarding/OnboardingOverlay.tsx
   :language: tsx
   :lines: 31-64
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Describes the overlay's inputs (props are the inputs one component is handed by the component using it): whether it is open, a close handler, a "load the sample project" action, a "start the guided tutorial" action, and an optional flag for whether a worked example is actually bundled with this build.

**Why it is here.** The field docstrings carry the reasons. ``App`` marks onboarding "seen" inside the close handler. The ``onLoadSample`` action is stubbed in the prototype because the sample ``.strix`` is not yet bundled with the build. ``sampleAvailable`` defaults to false so the sample card is offered ONLY when a file really exists behind it — the owner found on 2026-09-04 that with no file the card led straight into the tutorial on an empty project.

.. CG-EXPLANATION-END id=interface:Props

``function OnboardingOverlay``
------------------------------

.. CG-BLOCK id=function:OnboardingOverlay lines=65-237

.. literalinclude:: ../../../desktop/src/renderer/src/components/onboarding/OnboardingOverlay.tsx
   :language: tsx
   :lines: 65-237
   :lineno-match:

.. CG-EXPLANATION-START id=function:OnboardingOverlay

**What this does.** The overlay itself. It remembers which screen is showing and the pending choice (values kept between redraws, called state), and an effect (code that runs after a draw) resets it to the welcome screen every time it opens. It draws a Modal with an always-present Skip, then one of three screens: welcome (a Next button), choose (the sample card, shown only when a sample is bundled, plus the from-scratch card and a Back button), and start (offering "start the tutorial" or "later", plus Back). Choosing an option remembers it and moves to the start screen; finishing runs the chosen action — loading the sample if that was picked — and closes; starting the tutorial closes first and then hands off to it.

**Why it is here.** The comments carry the reasons. A Skip affordance is always present because ruling 24 says the tour must be skippable. The reset-on-open effect stops a re-open from Help from dropping the user back into the middle of a previous run. The sample card is shown only when a sample is bundled, for the reason recorded on the ``sampleAvailable`` input. Closing the overlay before handing off to the tutorial keeps the two from overlapping on screen.

.. CG-EXPLANATION-END id=function:OnboardingOverlay

