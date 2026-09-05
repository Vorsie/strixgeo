desktop.renderer.src.shell.stages.geology.useCameraLink
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/useCameraLink.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/useCameraLink.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-48

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/useCameraLink.ts
   :language: typescript
   :lines: 1-48
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file that keeps two 3-D viewports looking from the same angle — the camera link used by compare mode. In Cesium (the 3-D globe library) the camera is the virtual eye: where it sits, where it looks, how wide. The notes explain that comparing two models side by side only answers a question when both panes show the SAME viewpoint, and that this logic lives in its own file rather than as two more effects inside the already-large ``CesiumViewport`` (debt #201). The block also carries the hook's own docstring, which spells out exactly how the follower copies the leader each frame.

**Why it is here.** Two independently-panned cameras turn a question like does the geotech subdivision respect the litho units back into an eyeballing exercise; a shared viewpoint is what makes the comparison honest. The cut-style split deliberately does NOT link its cameras — each pane is one half of a single model, inspected on its own — so this link is used only by compare mode.

.. CG-EXPLANATION-END id=module-header

``function useCameraLink``
--------------------------

.. CG-BLOCK id=function:useCameraLink lines=49-92

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/useCameraLink.ts
   :language: typescript
   :lines: 49-92
   :lineno-match:

.. CG-EXPLANATION-START id=function:useCameraLink

**What this does.** A custom hook — a reusable ``use…`` function that lets a component tap a React feature — that can publish this viewport's camera for a sibling to follow, and/or mirror a sibling's camera. Its first effect (an effect runs after the screen is drawn), while mounted, writes this scene's camera onto a shared handle so another pane can find it, and clears the handle on unmount. Its second effect, when told to follow a leader, copies the leader's four orientation vectors — position, direction, up, right — onto its own camera once per frame just before drawing, and, because request-render mode would otherwise let the follower freeze, asks for a fresh frame after each one so it keeps redrawing while it follows.

**Why it is here.** It copies the pose in the about-to-draw step rather than on the camera's changed event, because that event only fires past a movement threshold and lags visibly during a slow orbit, and the follower's own writes would keep re-arming it; copying every frame gives no lag and is strictly one-directional, so no feedback loop is possible. It writes the four basis vectors directly rather than calling ``setView`` because that is the standard Cesium way to sync two viewers without fighting the follower's own mouse-controller for ownership of the view. A guard skips a missing leader, since the leader pane can unmount first on a layout change.

.. CG-EXPLANATION-END id=function:useCameraLink

