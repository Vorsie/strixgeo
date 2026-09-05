desktop.renderer.src.utils.onboardingSeen
=========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/onboardingSeen.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/onboardingSeen.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../desktop/src/renderer/src/utils/onboardingSeen.ts
   :language: typescript
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment. This file records whether this installation has already shown the first-launch onboarding overlay (a prototype, debt #93).

**Why it is here.** The comment records that this is per-device screen chrome, so it belongs in localStorage rather than the .strix project bundle (localStorage is per-user interface state; the bundle carries engineering decisions). Every accessor degrades to "not seen" and never throws, because a browser or Electron profile with storage disabled must still boot, and showing the overlay one extra time is a far better failure than crashing on the start path.

.. CG-EXPLANATION-END id=module-header

``const ONBOARDING_SEEN_KEY``
-----------------------------

.. CG-BLOCK id=const:ONBOARDING_SEEN_KEY lines=15-17

.. literalinclude:: ../../../desktop/src/renderer/src/utils/onboardingSeen.ts
   :language: typescript
   :lines: 15-17
   :lineno-match:

.. CG-EXPLANATION-START id=const:ONBOARDING_SEEN_KEY

**What this does.** The localStorage key the flag is stored under: ``strix.onboarding.seen.v1``.

**Why it is here.** The comment records that the ``v1`` in the name lets a future overlay redesign bump the version and re-show onboarding to everyone.

.. CG-EXPLANATION-END id=const:ONBOARDING_SEEN_KEY

``const SEEN_VALUE``
--------------------

.. CG-BLOCK id=const:SEEN_VALUE lines=18-28

.. literalinclude:: ../../../desktop/src/renderer/src/utils/onboardingSeen.ts
   :language: typescript
   :lines: 18-28
   :lineno-match:

.. CG-EXPLANATION-START id=const:SEEN_VALUE

**What this does.** The value written once the overlay has been completed or skipped.

**Why it is here.** A single stored marker meaning "this installation has seen onboarding".

.. CG-EXPLANATION-END id=const:SEEN_VALUE

``function hasSeenOnboarding``
------------------------------

.. CG-BLOCK id=function:hasSeenOnboarding lines=29-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/onboardingSeen.ts
   :language: typescript
   :lines: 29-37
   :lineno-match:

.. CG-EXPLANATION-START id=function:hasSeenOnboarding

**What this does.** Answers whether this installation has already seen onboarding, wrapped so that a storage failure simply returns false.

**Why it is here.** The docstring records that it is true once the overlay has been marked seen, and false on a fresh install or whenever storage cannot be read.

.. CG-EXPLANATION-END id=function:hasSeenOnboarding

``function markOnboardingSeen``
-------------------------------

.. CG-BLOCK id=function:markOnboardingSeen lines=38-66

.. literalinclude:: ../../../desktop/src/renderer/src/utils/onboardingSeen.ts
   :language: typescript
   :lines: 38-66
   :lineno-match:

.. CG-EXPLANATION-START id=function:markOnboardingSeen

**What this does.** Records that the overlay was completed or skipped so it does not fire again, wrapped so a storage failure is silently ignored.

**Why it is here.** The comment records that if storage is unavailable the overlay just shows again next launch, which is harmless for a prototype and never worth throwing an error on the boot path.

.. CG-EXPLANATION-END id=function:markOnboardingSeen

``function shouldAutoOpenOnboarding``
-------------------------------------

.. CG-BLOCK id=function:shouldAutoOpenOnboarding lines=67-69

.. literalinclude:: ../../../desktop/src/renderer/src/utils/onboardingSeen.ts
   :language: typescript
   :lines: 67-69
   :lineno-match:

.. CG-EXPLANATION-START id=function:shouldAutoOpenOnboarding

**What this does.** Answers whether the first-launch overlay should open on its own: only when onboarding has not been seen AND the app is not running under the end-to-end test harness.

**Why it is here.** The docstring records that the test-harness condition is the blocker fix: the harness's user-data directory persists across a run and nothing seeds the "seen" flag, so without this guard the top-most onboarding modal would open over every test and fail about 130 of them on an intercepted click.

.. CG-EXPLANATION-END id=function:shouldAutoOpenOnboarding

