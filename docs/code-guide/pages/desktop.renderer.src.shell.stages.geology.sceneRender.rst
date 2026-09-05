desktop.renderer.src.shell.stages.geology.sceneRender
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/sceneRender.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/sceneRender.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/sceneRender.ts
   :language: typescript
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file that controls WHEN the 3-D geology viewports redraw. Cesium is the 3-D globe library the geology viewers draw on, and a Cesium widget is one 3-D window; a scene is the 3-D world inside it. The file's notes explain that a widget normally repaints about sixty times a second even when nothing has moved, which burns a graphics-card core for no visible change, and that turning on request-render mode makes the scene repaint only when something explicitly asks. It ends with a one-line description of a scene that can be asked to redraw.

**Why it is here.** A static geological model has no animation, so continuous repainting is pure waste; drawing only on demand frees the graphics card. The trade-off the file records: because nothing repaints on its own, every change to the scene — a rebuilt shape, a moved camera, the compare-mode follower — must now ask for a redraw by hand, or the change stays invisible until the next stray trigger. Both the settings object and that single changed-so-redraw seam live here, in one tested place, so the viewport, the wheel-zoom tuning and the camera link all reuse them.

.. CG-EXPLANATION-END id=module-header

``interface RenderableScene``
-----------------------------

.. CG-BLOCK id=interface:RenderableScene lines=21-30

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/sceneRender.ts
   :language: typescript
   :lines: 21-30
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RenderableScene

**What this does.** Names the least a scene must offer for this module — a single ``requestRender()`` method that asks for one repaint. An ``interface`` is a note describing the shape of an object.

**Why it is here.** Narrowing to just the one method it needs, rather than depending on the full ``Cesium.Scene`` type, keeps the redraw helper testable without a real graphics context and states plainly the only thing this module touches.

.. CG-EXPLANATION-END id=interface:RenderableScene

``const REQUEST_RENDER_WIDGET_OPTIONS``
---------------------------------------

.. CG-BLOCK id=const:REQUEST_RENDER_WIDGET_OPTIONS lines=31-54

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/sceneRender.ts
   :language: typescript
   :lines: 31-54
   :lineno-match:

.. CG-EXPLANATION-START id=const:REQUEST_RENDER_WIDGET_OPTIONS

**What this does.** A small fixed settings object spread into a Cesium widget when it is created: ``requestRenderMode`` set true (draw only when asked, not every frame) and ``maximumRenderTimeChange`` set to infinity (never let the passage of simulated time force a repaint).

**Why it is here.** The two together make an idle 3-D view truly stop drawing. Infinity is chosen because the scene has no time-animated content — no moving sun or atmosphere — so nothing about elapsed time should ever trigger a new frame.

.. CG-EXPLANATION-END id=const:REQUEST_RENDER_WIDGET_OPTIONS

``function requestSceneRender``
-------------------------------

.. CG-BLOCK id=function:requestSceneRender lines=55-58

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/sceneRender.ts
   :language: typescript
   :lines: 55-58
   :lineno-match:

.. CG-EXPLANATION-START id=function:requestSceneRender

**What this does.** The one helper that asks a scene to draw a single frame. Given a scene it calls ``requestRender()``; given ``null`` — the widget has not mounted yet — it does nothing.

**Why it is here.** It is the single doorway every scene change passes through under request-render mode: a rebuilt shape, a programmatic camera move, or the compare follower keeping itself alive. That makes it the one place a test can assert a change asked for a redraw, and the null-guard means a not-yet-mounted viewport is a safe no-op rather than a crash.

.. CG-EXPLANATION-END id=function:requestSceneRender

