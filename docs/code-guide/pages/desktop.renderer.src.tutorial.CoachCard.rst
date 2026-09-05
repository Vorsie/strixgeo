desktop.renderer.src.tutorial.CoachCard
=======================================

.. CG-PAGE source=desktop/src/renderer/src/tutorial/CoachCard.tsx complete=true

*Source file:* ``desktop/src/renderer/src/tutorial/CoachCard.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/CoachCard.tsx
   :language: tsx
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the imports. The comment describes the coach card — the tour's speech bubble that sits beside the spotlighted control (or docked bottom-right when the control is off screen), names the chapter and step, explains what to do in a few sentences, and carries the navigation buttons. It records the rules the card follows: a do-it step shows NO Next button (a hint says the tour moves on by itself) while an explain step carries Next / Finish; Back, Skip step, and Skip tutorial are always available; and when a chapter has a worked-example clip, a ``Watch the clip`` button opens it in the browser. The imports pull in two icons, the translation hook, and the data shapes the card displays.

**Why it is here.** A *component* is a reusable piece of on-screen interface written as a function that returns what to draw. This card is presentational only — it draws what it is handed and reports clicks back; it holds no tour logic. Showing Next only for explain steps mirrors the two step kinds from the ``tutorialMachine`` page, and keeping Back and Skip always available is the stance that the tour must never trap the user.

.. CG-EXPLANATION-END id=module-header

``const CARD_WIDTH``
--------------------

.. CG-BLOCK id=const:CARD_WIDTH lines=20-20

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/CoachCard.tsx
   :language: tsx
   :lines: 20-20
   :lineno-match:

.. CG-EXPLANATION-START id=const:CARD_WIDTH

**What this does.** The card's fixed width, 340 pixels.

**Why it is here.** The docstring calls this a fixed footprint used both for the card's own layout and for the placement decision, so the card and ``placeCoachCard`` agree on the same size.

.. CG-EXPLANATION-END id=const:CARD_WIDTH

``const CARD_HEIGHT``
---------------------

.. CG-BLOCK id=const:CARD_HEIGHT lines=21-23

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/CoachCard.tsx
   :language: tsx
   :lines: 21-23
   :lineno-match:

.. CG-EXPLANATION-START id=const:CARD_HEIGHT

**What this does.** The card's assumed height, 240 pixels.

**Why it is here.** Same fixed-footprint reason: the placement maths is fed this height so it can check whether the card fits beside or below a control.

.. CG-EXPLANATION-END id=const:CARD_HEIGHT

``interface CoachCardProps``
----------------------------

.. CG-BLOCK id=interface:CoachCardProps lines=24-63

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/CoachCard.tsx
   :language: tsx
   :lines: 24-63
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CoachCardProps

**What this does.** Lists everything the card is handed: the step to show, its chapter title key, the progress-strip numbers, an optional video URL and a callback to open it, where the card sits, and a set of flags — is this an explain step, is it the last step, is the target off screen, is the fallback highlighting the stage tab, can Back be used — plus the four button callbacks (Back, Next, Skip step, Skip tutorial).

**Why it is here.** *Props* are the inputs passed into a component. Listing them as one shape is the contract between the overlay, which supplies them, and the card, which draws them. Because every decision arrives as a prop, the card carries no logic of its own and is trivially testable.

.. CG-EXPLANATION-END id=interface:CoachCardProps

``function CoachCard``
----------------------

.. CG-BLOCK id=function:CoachCard lines=64-168

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/CoachCard.tsx
   :language: tsx
   :lines: 64-168
   :lineno-match:

.. CG-EXPLANATION-START id=function:CoachCard

**What this does.** The card component. It looks up the translation function, then draws a fixed-position dialog box: a header with the chapter title, the step title, and the step body text; an off-screen hint (either ``open the tab`` or a generic off-screen note) when the control is not visible; a ``moves on by itself`` hint with a check icon for a do-it step that IS visible; and, when the chapter has a clip, a ``Watch the clip`` button. Below that, a progress strip reads ``chapter i of n, step j of m``, and a navigation row shows Back and Skip tutorial on the left and either Skip step (do-it) or Next / Finish (explain) on the right. Every button carries a ``data-testid`` and calls the matching callback prop.

**Why it is here.** Every visible word comes through the translation function ``t(...)`` keyed on a message name, because the app's text lives in the language catalogues — this is translate-at-the-presentation-boundary, and it is what lets the tutorial follow the app language. The Next-versus-Skip split and the off-screen hint are the rules from the header made visible. The buttons carry ``data-testid`` labels so the automated tour tests (and the tour itself) can find them by name.

.. CG-EXPLANATION-END id=function:CoachCard

