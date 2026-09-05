desktop.renderer.src.tutorial.useAnchorRect
===========================================

.. CG-PAGE source=desktop/src/renderer/src/tutorial/useAnchorRect.ts complete=true

*Source file:* ``desktop/src/renderer/src/tutorial/useAnchorRect.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/useAnchorRect.ts
   :language: typescript
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the imports. The comment explains that this hook resolves a control's ``data-testid`` to its live position on screen — its bounding rectangle. Both the spotlight and the coach card ride on that rectangle. Because the control can move, resize, or not exist yet, the hook re-measures on resize, on scroll, and on any change to the page, throttled so a burst of changes costs only one measure. It returns ``null`` when the control is absent — the card then docks bottom-right and tells the user which tab to open. The imports pull in ``useEffect`` and ``useState`` plus the ``AnchorRect`` shape.

**Why it is here.** A *hook* is a helper whose name starts with ``use…`` that lets a piece of interface remember values and run side tasks. Re-measuring on every layout change is what keeps the spotlight glued to a control that scrolls or to a stage that has just switched; throttling the measures to one per animation frame is the per-frame-work caching discipline from CLAUDE.md — a flurry of page changes still costs just one measurement.

.. CG-EXPLANATION-END id=module-header

``function toRect``
-------------------

.. CG-BLOCK id=function:toRect lines=14-32

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/useAnchorRect.ts
   :language: typescript
   :lines: 14-32
   :lineno-match:

.. CG-EXPLANATION-START id=function:toRect

**What this does.** A tiny helper that reads an element's on-screen rectangle (via the browser's ``getBoundingClientRect``) and copies its six numbers — left, top, right, bottom, width, height — into a plain ``AnchorRect`` object.

**Why it is here.** It reduces the browser's rich rectangle object to the plain shape the placement maths needs, which keeps that maths a pure function testable without a browser (see the ``coachCardPlacement`` page).

.. CG-EXPLANATION-END id=function:toRect

``function useAnchorRect``
--------------------------

.. CG-BLOCK id=function:useAnchorRect lines=33-86

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/useAnchorRect.ts
   :language: typescript
   :lines: 33-86
   :lineno-match:

.. CG-EXPLANATION-START id=function:useAnchorRect

**What this does.** The hook. It keeps one piece of remembered state — the current rectangle, starting ``null``. Inside an *effect* (code that runs after a redraw) keyed on the testid: if there is no testid it clears the rectangle and stops. Otherwise it builds a safe selector for that testid (escaping any special characters), defines a ``measure`` that finds the element and stores its rectangle or ``null``, and a ``schedule`` that coalesces a burst of changes into a single measure on the next animation frame. It measures once immediately, then watches for change: a ``ResizeObserver`` on the element and on the page body, a ``MutationObserver`` on the whole body (so it notices the control appearing or moving), plus window resize and scroll listeners (scroll in capture phase, so a scroll on any inner container re-measures too). Its cleanup cancels the pending frame and removes every observer and listener. It returns the current rectangle.

**Why it is here.** An *effect* runs a side task after a redraw, and its *cleanup* is the tidy-up run before it re-runs or the component leaves. The comments explain the choices: the first measure is synchronous so the first paint is not a frame late; the ``MutationObserver`` watches the whole body because the target may not exist yet (its stage is not open); the capture-phase scroll and the ``CSS.escape`` guard are the two robustness notes. The cleanup removing everything is what stops old listeners from piling up each time the step, and so the testid, changes.

.. CG-EXPLANATION-END id=function:useAnchorRect

