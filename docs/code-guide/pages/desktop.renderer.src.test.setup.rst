desktop.renderer.src.test.setup
===============================

.. CG-PAGE source=desktop/src/renderer/src/test/setup.ts complete=true

*Source file:* ``desktop/src/renderer/src/test/setup.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../desktop/src/renderer/src/test/setup.ts
   :language: typescript
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The first import and the opening comment. It imports the jest-dom matchers add-on (extra checks like ``is this element visible`` for the test runner), and begins the file's job: patching in the few browser features the fake test browser (jsdom) lacks. The comment describes the first patch — jsdom ships no ``ResizeObserver``, but the chart library's responsive container calls ``new ResizeObserver(...)`` on mount and would throw, so a no-op stand-in is enough because these tests do not check chart layout.

**Why it is here.** So the automated tests run offline and deterministically. jsdom is a lightweight fake browser with no real layout engine; the tests only check that panels render, not pixel layout, so a do-nothing ``ResizeObserver`` is sufficient to let chart-bearing panels mount without throwing.

.. CG-EXPLANATION-END id=module-header

``class NoopResizeObserver``
----------------------------

.. CG-BLOCK id=class:NoopResizeObserver lines=9-52

.. literalinclude:: ../../../desktop/src/renderer/src/test/setup.ts
   :language: typescript
   :lines: 9-52
   :lineno-match:

.. CG-EXPLANATION-START id=class:NoopResizeObserver

**What this does.** Defines a do-nothing ``ResizeObserver`` (its ``observe`` / ``unobserve`` / ``disconnect`` methods do nothing) and installs it as the global if none exists. The rest of the block patches two more missing pieces the same way: it gives elements a no-op ``scrollTo`` (BoreholeLog's auto-scroll calls it), and gives the window a ``matchMedia`` stub reporting ``system light`` with no-op listener wiring (useTheme reads it on mount).

**Why it is here.** So the automated tests run offline and deterministically. Each patch fills a jsdom gap that a real browser has, so components that call these APIs on mount do not throw during tests; every stand-in is a no-op because these tests do not check layout, scroll position, or theme resolution — only that the surrounding components render. The inline comment also notes the assignment must go through an ``unknown`` cast because TypeScript types the global object as const-shaped.

.. CG-EXPLANATION-END id=class:NoopResizeObserver

