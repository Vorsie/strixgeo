desktop.renderer.src.components.sections.dragThreshold
======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/dragThreshold.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/dragThreshold.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/dragThreshold.ts
   :language: typescript
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file: it is the click-versus-drag gate for the litho-boundary freedraw gestures — a pure module with no React, no clock and no randomness.

**Why it is here.** The docstring records the S105 owner dogfeed of 2026-07-24 ('i click on the position of the marker and this weird clay quad appears out of nowhere'): the correlate-on-drag mechanism fired on a press with zero cursor movement, snapping a pinched-out clay to a flat band and posting the correlation. The fix is to gate the mechanism on a minimum cursor travel so a pure click is inert.

.. CG-EXPLANATION-END id=module-header

``const DRAG_THRESHOLD``
------------------------

.. CG-BLOCK id=const:DRAG_THRESHOLD lines=30-54

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/dragThreshold.ts
   :language: typescript
   :lines: 30-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:DRAG_THRESHOLD

**What this does.** The minimum cursor travel, about 4 pixels, before a drag counts as deliberate rather than a click.

**Why it is here.** The docstring records it sits just below the roughly 5-pixel operating-system double-click slop, so a real drag crosses it almost instantly while a genuine click, even with a pixel or two of hand jitter, stays under it and reshapes nothing.

.. CG-EXPLANATION-END id=const:DRAG_THRESHOLD

``function dragCrossedThreshold``
---------------------------------

.. CG-BLOCK id=function:dragCrossedThreshold lines=55-67

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/dragThreshold.ts
   :language: typescript
   :lines: 55-67
   :lineno-match:

.. CG-EXPLANATION-START id=function:dragCrossedThreshold

**What this does.** Answers whether a drag has moved past the threshold from its mousedown origin, returning false when the origin is unknown.

**Why it is here.** The docstring records that an unknown origin cannot prove deliberate movement, so it is treated as a click and the gated action stays suppressed; in the real overlay the origin is always stamped at mousedown, so this only guards older test fixtures.

.. CG-EXPLANATION-END id=function:dragCrossedThreshold

