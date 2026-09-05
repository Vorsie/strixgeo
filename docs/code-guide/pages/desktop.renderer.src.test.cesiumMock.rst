desktop.renderer.src.test.cesiumMock
====================================

.. CG-PAGE source=desktop/src/renderer/src/test/cesiumMock.ts complete=true

*Source file:* ``desktop/src/renderer/src/test/cesiumMock.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/test/cesiumMock.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the documentation comment for ``makeStub``. The comment explains that this is an inert stand-in for the Cesium 3-D map library, used only in the component-mount smoke tests. It notes that the real Cesium widget builds a WebGL2 graphics context that the test environment (jsdom, a lightweight fake browser) does not provide, so a component that imports Cesium cannot mount under the test runner without a stub. Rather than hand-write stubs for the dozens of Cesium symbols a viewer touches, this module auto-creates every symbol on demand: any property access yields a stub that is itself callable, constructable, assignable, and further property-accessible, so the component mounts and its Cesium calls run as harmless no-ops. It stresses that this is a *shell* harness — it does NOT exercise real Cesium maths, which is unit-tested separately in ``cesiumGeometry.ts``; the smoke test's job is only the component shell (effect wiring, the null guards, and rebuilds across prop changes).

**Why it is here.** So the automated tests run offline and deterministically. A *mock* (or *stub*) is a fake stand-in that satisfies the code's calls without doing the real work. jsdom has no real graphics, so a real 3-D viewer cannot mount there; the auto-stub lets the component-shell tests run anyway (debt #41b). The pure 3-D maths is tested for real elsewhere, so nothing load-bearing is faked here.

.. CG-EXPLANATION-END id=module-header

``function makeStub``
---------------------

.. CG-BLOCK id=function:makeStub lines=24-55

.. literalinclude:: ../../../desktop/src/renderer/src/test/cesiumMock.ts
   :language: typescript
   :lines: 24-55
   :lineno-match:

.. CG-EXPLANATION-START id=function:makeStub

**What this does.** Builds one all-purpose fake object. It starts from an empty function and wraps it in a *Proxy* — a wrapper that intercepts every interaction. Reading any property returns another fake (created once and then remembered), so deep chains like ``widget.scene.postProcessStages.fxaa.enabled`` never fail; setting a property stores the value; calling it, or using it with ``new``, returns yet another fake. Two special cases: asked to convert to a plain value it yields ``0`` (so it degrades to a number instead of throwing inside arithmetic or a text template), and asked for ``then`` it returns nothing (so an accidentally-awaited fake does not hang).

**Why it is here.** So the automated tests run offline and deterministically. A *Proxy* is a wrapper that catches every property read, write, and call. Auto-creating every access is what lets one tiny helper stand in for a large library without hand-listing its symbols; the two special cases (convert-to-value gives 0, ``then`` gives nothing) are the guardrails that keep a stub from throwing or hanging when it leaks into arithmetic or an ``await``.

.. CG-EXPLANATION-END id=function:makeStub

``const cesiumNamespaceMock``
-----------------------------

.. CG-BLOCK id=const:cesiumNamespaceMock lines=56-67

.. literalinclude:: ../../../desktop/src/renderer/src/test/cesiumMock.ts
   :language: typescript
   :lines: 56-67
   :lineno-match:

.. CG-EXPLANATION-START id=const:cesiumNamespaceMock

**What this does.** The fake module handed to the test runner in place of the real ``'cesium'`` import. It is a Proxy over an empty object: any symbol read (``Cesium.CesiumWidget``, ``Cesium.Cartesian3``, and so on) creates and remembers an inert stub; it reports itself as an ES module and points its ``default`` back at itself; and it returns nothing for ``then``.

**Why it is here.** So the automated tests run offline and deterministically. This is what ``vi.mock('cesium', …)`` returns, so every Cesium symbol the viewer touches resolves to a harmless stub. The module-marker and ``default`` handling is the standard interop so both the ``import * as Cesium`` and the ``import Cesium`` styles work; the ``then`` guard again prevents an awaited namespace from hanging.

.. CG-EXPLANATION-END id=const:cesiumNamespaceMock

