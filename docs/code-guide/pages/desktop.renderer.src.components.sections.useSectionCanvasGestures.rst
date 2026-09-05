desktop.renderer.src.components.sections.useSectionCanvasGestures
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/useSectionCanvasGestures.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/useSectionCanvasGestures.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-62

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useSectionCanvasGestures.ts
   :language: typescript
   :lines: 1-62
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The native-event gesture hooks for the section canvas: the cursor-anchored wheel zoom and the section-wide Esc peel cascade.

**Why it is here.** Extracted from the section panel (debt #201 move 4) so the orchestrator stays focused on viewport state and render composition. React's own wheel handler is passive by default, so ``preventDefault`` is a no-op there; the listener is attached natively with a non-passive flag to intercept the page scroll. The cursor anchor is spacing-aware: it reads the post-nudge column positions, not the raw projected along-distance, so what is under the cursor stays pinned at any spacing value. This anchor math has bitten three times when computed against the raw along-distance or against an approximation of the packed layout.

.. CG-EXPLANATION-END id=module-header

``interface SectionWheelLayoutState``
-------------------------------------

.. CG-BLOCK id=interface:SectionWheelLayoutState lines=63-84

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useSectionCanvasGestures.ts
   :language: typescript
   :lines: 63-84
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionWheelLayoutState

**What this does.** The layout snapshot the wheel handler reads (through a ref) so it can re-run the real horizontal layout at a scale it has not rendered yet.

**Why it is here.** Its column list is the focus-filtered drawn set, not the raw layout, so the simulated layout matches the anchors actually on screen even in column focus; reading it through a ref avoids a temporal-dead-zone ordering problem in the parent's component body.

.. CG-EXPLANATION-END id=interface:SectionWheelLayoutState

``function layoutFootprints``
-----------------------------

.. CG-BLOCK id=function:layoutFootprints lines=85-109

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useSectionCanvasGestures.ts
   :language: typescript
   :lines: 85-109
   :lineno-match:

.. CG-EXPLANATION-START id=function:layoutFootprints

**What this does.** Re-describes the drawn columns as layout footprints, so the wheel zoom can lay them out again at a candidate scale.

**Why it is here.** It reuses the CPT band-width helper so the applicable-channel rule lives in exactly one place and survives the band half-width changing under the zoom.

.. CG-EXPLANATION-END id=function:layoutFootprints

``interface SectionWheelZoomParams``
------------------------------------

.. CG-BLOCK id=interface:SectionWheelZoomParams lines=110-147

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useSectionCanvasGestures.ts
   :language: typescript
   :lines: 110-147
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionWheelZoomParams

**What this does.** The inputs to the wheel-zoom hook: the container ref, the live warp anchors, the spacing and layout snapshots, the current viewport, the horizontal and vertical scales, the level anchor, the plot size, and the viewport setter.

**Why it is here.** The refs are read at call time so the handler is never re-created on their changing identity, and the scales and plot size drive the zoom factor and the level anchor.

.. CG-EXPLANATION-END id=interface:SectionWheelZoomParams

``function useSectionWheelZoom``
--------------------------------

.. CG-BLOCK id=function:useSectionWheelZoom lines=148-265

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useSectionCanvasGestures.ts
   :language: typescript
   :lines: 148-265
   :lineno-match:

.. CG-EXPLANATION-START id=function:useSectionWheelZoom

**What this does.** Attaches a non-passive wheel listener; on each wheel it reads the cursor pixel, bails when the cursor is outside the plot area, computes the post-zoom scale, refuses the step when the band half-width is already clamped and would not change, then solves the exact cursor-anchored viewport left edge (re-running the real layout) and re-centres the viewport so the world point under the cursor stays under the cursor.

**Why it is here.** The exact solve replaces the old approach of picking the nearest column and standing in a band-half-width ratio for the packed offset, which snapped to a neighbour when the cursor sat between columns and, because the ratio was inexact, crept the camera left over repeated wheeling (dogfeed 2026-08-15: when i zoom in and out the camera slowly moves left). The clamp refusal stops the tests elongating when the horizontal scale has stopped growing but the vertical keeps going (dogfeed 2026-05-31).

.. CG-EXPLANATION-END id=function:useSectionWheelZoom

``interface SectionKeyboardShortcutsParams``
--------------------------------------------

.. CG-BLOCK id=interface:SectionKeyboardShortcutsParams lines=266-319

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useSectionCanvasGestures.ts
   :language: typescript
   :lines: 266-319
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionKeyboardShortcutsParams

**What this does.** The inputs to the Esc-peel hook: a flag for each open surface (an armed join, the body menu, the column menu, a focused column, a selected geotech body) and the callback to close each.

**Why it is here.** They are passed as booleans rather than the underlying menu objects so the hook stays decoupled from the menu shapes and re-attaches its listener only on a genuine open-or-closed transition. The armed-join flag peels first (owner 2026-09-01; renamed from the old separate-armed when the Separate verb was removed) because an armed gesture is the most recently opened surface.

.. CG-EXPLANATION-END id=interface:SectionKeyboardShortcutsParams

``function useSectionKeyboardShortcuts``
----------------------------------------

.. CG-BLOCK id=function:useSectionKeyboardShortcuts lines=320-386

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useSectionCanvasGestures.ts
   :language: typescript
   :lines: 320-386
   :lineno-match:

.. CG-EXPLANATION-START id=function:useSectionKeyboardShortcuts

**What this does.** One keydown listener on the document that, on Escape and only when the user is not typing into a field, peels the most recently opened surface in priority order: the armed join, then the body menu, the column menu, the geotech selection, the column focus, and finally closing the section.

**Why it is here.** It mirrors the Data-stage Esc-to-map peel (debt #43). The typing guard means it never steals a text-editing Esc, and the final peel deselects the section, which unmounts the panel and falls back to the section map view.

.. CG-EXPLANATION-END id=function:useSectionKeyboardShortcuts

