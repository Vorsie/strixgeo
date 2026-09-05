desktop.renderer.src.components.sections.useMenuDismiss
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/useMenuDismiss.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/useMenuDismiss.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useMenuDismiss.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A hook that auto-dismisses a fixed-position context menu on a wheel-zoom or on Esc.

**Why it is here.** It began as an inline effect (debt #151 dogfeed refinement 2026-05-27: sometimes i get this random add new suggestion here box when zooming or so). A fixed-position menu detaches from the section content the moment the user zooms and reads as a random floating box. The partition-fill region menu copied the pattern, and the model-fill menu (owner ruling 2026-08-27) would have been the third copy, so it was extracted instead.

.. CG-EXPLANATION-END id=module-header

``function useMenuDismissOnZoomOrEsc``
--------------------------------------

.. CG-BLOCK id=function:useMenuDismissOnZoomOrEsc lines=22-40

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useMenuDismiss.ts
   :language: typescript
   :lines: 22-40
   :lineno-match:

.. CG-EXPLANATION-START id=function:useMenuDismissOnZoomOrEsc

**What this does.** While the menu is open, listens for any wheel event or the Escape key and dismisses the menu; it does nothing while the menu is closed.

**Why it is here.** The wheel listener is attached in capture mode so it fires before the zoom handler, and the effect re-subscribes on the open flag alone; the recorded reason notes that the dismiss function's identity is not load-bearing, so re-subscribing only on open keeps the listeners scoped to the menu's lifetime.

.. CG-EXPLANATION-END id=function:useMenuDismissOnZoomOrEsc

