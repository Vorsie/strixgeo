desktop.renderer.src.tutorial.useTutorialState
==============================================

.. CG-PAGE source=desktop/src/renderer/src/tutorial/useTutorialState.ts complete=true

*Source file:* ``desktop/src/renderer/src/tutorial/useTutorialState.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/useTutorialState.ts
   :language: typescript
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the imports. The comment explains that this *hook* feeds the tour's do-it conditions: it reads the shell bus through ``useShell()`` and derives the observable facts using the pure ``deriveTutorialState``. It returns a value-memoised object, so its identity stays the same while the facts are unchanged — the overlay's advance step depends on it, and a fresh object every redraw would re-fire that step endlessly. It notes that the overlay is mounted inside the shell provider so ``useShell()`` returns a real value, and that the null guard is belt-and-braces. The imports pull in ``useMemo``, the shell hook and its type, and the derive/empty helpers.

**Why it is here.** A *hook* is a helper whose name starts with ``use…`` that lets a piece of interface remember values and run side tasks; *useMemo* caches a computed value so it is not rebuilt on every redraw. This hook is the thin wrapper marrying React to the pure logic on the ``tutorialState`` page. Returning a *stable identity* — the same object while the facts hold — is the memo discipline from CLAUDE.md: an object rebuilt fresh every redraw would make every dependent step re-run and spin an endless redraw loop.

.. CG-EXPLANATION-END id=module-header

``function useTutorialState``
-----------------------------

.. CG-BLOCK id=function:useTutorialState lines=27-50

.. literalinclude:: ../../../desktop/src/renderer/src/tutorial/useTutorialState.ts
   :language: typescript
   :lines: 27-50
   :lineno-match:

.. CG-EXPLANATION-START id=function:useTutorialState

**What this does.** The hook itself. It reads the shell context (or ``null`` if somehow used outside a provider), derives the facts (or the empty state when there is no shell), then returns them through ``useMemo`` keyed on the individual fields — projectOpen, the counts, the flags — rather than on the object as a whole. A ``// reason:`` comment explains the accompanying eslint suppression.

**Why it is here.** The ``// reason:`` comment records why the linter is overruled here: the derived object is intentionally rebuilt every redraw (the derivation is pure), so listing the object as the dependency would defeat the memo and re-fire every dependent step; the field list IS the true set of things that can change. A CLAUDE.md rule requires every ``exhaustive-deps`` suppression to carry exactly such a reason.

.. CG-EXPLANATION-END id=function:useTutorialState

