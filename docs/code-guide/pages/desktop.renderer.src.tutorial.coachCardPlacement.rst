desktop.renderer.src.tutorial.coachCardPlacement
================================================

.. CG-PAGE source=desktop/src/renderer/src/tutorial/coachCardPlacement.ts complete=true

*Source file:* ``desktop/src/renderer/src/tutorial/coachCardPlacement.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/coachCardPlacement.ts
   :language: typescript
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment. It explains that this file holds the pure geometry that decides where the coach card sits: given the spotlighted control's rectangle, the card's size, and the viewport (the visible window area), it places the card to the right of the control, else below it, else docked bottom-right when the control is off screen or the space is too tight. It is kept out of the card component so the decision can be tested without a browser.

**Why it is here.** This is the same pure-maths split used elsewhere in the tour: geometry separated from drawing so it can be unit-tested against plain numbers (CLAUDE.md, mirroring ``deriveTutorialState`` and ``toRect``).

.. CG-EXPLANATION-END id=module-header

``interface AnchorRect``
------------------------

.. CG-BLOCK id=interface:AnchorRect lines=9-18

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/coachCardPlacement.ts
   :language: typescript
   :lines: 9-18
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AnchorRect

**What this does.** The shape of a control's screen rectangle — the six numbers ``getBoundingClientRect`` gives: left, top, right, bottom, width, and height.

**Why it is here.** A named shape shared by ``useAnchorRect`` (which fills it in) and this file (which reads it), so the two agree without either importing the browser's own rectangle type.

.. CG-EXPLANATION-END id=interface:AnchorRect

``type CardPlacement``
----------------------

.. CG-BLOCK id=type:CardPlacement lines=19-21

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/coachCardPlacement.ts
   :language: typescript
   :lines: 19-21
   :lineno-match:

.. CG-EXPLANATION-START id=type:CardPlacement

**What this does.** Names the three possible outcomes of the placement decision: ``'right'``, ``'below'``, or ``'docked'``.

**Why it is here.** A *union* of the allowed values. Recording which rule placed the card lets the tests assert the decision and lets the card apply the matching style.

.. CG-EXPLANATION-END id=type:CardPlacement

``interface PlacedCard``
------------------------

.. CG-BLOCK id=interface:PlacedCard lines=22-31

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/coachCardPlacement.ts
   :language: typescript
   :lines: 22-31
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PlacedCard

**What this does.** The resolved position: the card's left and top in viewport pixels, plus which rule placed it there.

**Why it is here.** The single result object the placement function returns and the overlay applies to the card.

.. CG-EXPLANATION-END id=interface:PlacedCard

``const DOCK_MARGIN``
---------------------

.. CG-BLOCK id=const:DOCK_MARGIN lines=32-34

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/coachCardPlacement.ts
   :language: typescript
   :lines: 32-34
   :lineno-match:

.. CG-EXPLANATION-START id=const:DOCK_MARGIN

**What this does.** The 24-pixel margin the card is kept inside the window edges, also used as the inset when the card is docked in the corner.

**Why it is here.** One constant, so the edge gap is the same whether the card is clamped near an edge or parked in the corner.

.. CG-EXPLANATION-END id=const:DOCK_MARGIN

``function clamp``
------------------

.. CG-BLOCK id=function:clamp lines=35-63

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/coachCardPlacement.ts
   :language: typescript
   :lines: 35-63
   :lineno-match:

.. CG-EXPLANATION-START id=function:clamp

**What this does.** A small maths helper that forces a number to stay within a low/high range: below the low it returns the low, above the high it returns the high, otherwise the number itself; and if the range is inverted it returns the low.

**Why it is here.** The docstring notes it is used to keep the card fully inside the vertical or horizontal margins when it is aligned to a control that sits near a window edge.

.. CG-EXPLANATION-END id=function:clamp

``function placeCoachCard``
---------------------------

.. CG-BLOCK id=function:placeCoachCard lines=64-92

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/coachCardPlacement.ts
   :language: typescript
   :lines: 64-92
   :lineno-match:

.. CG-EXPLANATION-START id=function:placeCoachCard

**What this does.** The placement decision. It first works out the docked bottom-right position as the fallback. If there is no anchor (the control is off screen) it docks immediately. Otherwise it tries, in order: to the right of the control (card top aligned to the control, clamped inside the top/bottom margins) if it fits; then below the control (card left aligned, clamped inside the left/right margins) if it fits; otherwise it docks.

**Why it is here.** The docstring spells out the order — right, then below, then dock, with a null anchor docking at once. Being a pure function of its three inputs means the overlay simply applies the answer and the tests can check every branch with plain numbers.

.. CG-EXPLANATION-END id=function:placeCoachCard

