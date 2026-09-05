desktop.renderer.src.components.sections.usePairArm
===================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/usePairArm.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/usePairArm.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/usePairArm.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A hook holding the body-identity pair arm: the one armed pick-the-other-body gesture at a time, which drives the Join-with verb.

**Why it is here.** Debt #278, extracted off the god-component (debt #201) so its lifecycle rules are unit-testable. After the body-verb simplification (owner ruling 2026-09-01: way too complicated) only one verb remains, Join, so the arm no longer carries a kind and is always a join arm. It is axis-scoped and stale-prone, so three rules retire it automatically: any axis change, correlate mode taking over, and its anchor layer vanishing.

.. CG-EXPLANATION-END id=module-header

``interface PairArm``
---------------------

.. CG-BLOCK id=interface:PairArm lines=26-35

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/usePairArm.ts
   :language: typescript
   :lines: 26-35
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PairArm

**What this does.** The armed body: its id, the deterministic anchor layer the union posts through, and its display label for the hint chip.

**Why it is here.** It names the body the engineer armed to act from.

.. CG-EXPLANATION-END id=interface:PairArm

``interface UsePairArmOptions``
-------------------------------

.. CG-BLOCK id=interface:UsePairArmOptions lines=36-45

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/usePairArm.ts
   :language: typescript
   :lines: 36-45
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UsePairArmOptions

**What this does.** What the automatic-retire rules read: the active section axis, whether correlate mode owns the canvas, and a layer-to-body map spanning both axes.

**Why it is here.** These are the three inputs the automatic-clear rules watch.

.. CG-EXPLANATION-END id=interface:UsePairArmOptions

``interface UsePairArmResult``
------------------------------

.. CG-BLOCK id=interface:UsePairArmResult lines=46-71

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/usePairArm.ts
   :language: typescript
   :lines: 46-71
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UsePairArmResult

**What this does.** The arm state plus its setter and a clear callback.

**Why it is here.** The arm and pick gesture handlers stay in the caller, which needs the body-resolution map and the commit callbacks; the hook owns only the state and its automatic-clear lifecycle.

.. CG-EXPLANATION-END id=interface:UsePairArmResult

``function usePairArm``
-----------------------

.. CG-BLOCK id=function:usePairArm lines=72-96

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/usePairArm.ts
   :language: typescript
   :lines: 72-96
   :lineno-match:

.. CG-EXPLANATION-START id=function:usePairArm

**What this does.** Holds the arm and, in three separate effects, clears it on any axis change, on correlate mode turning on, and when its anchor layer no longer exists in the layer-to-body map.

**Why it is here.** An arm that outlived an axis switch would commit a cross-axis pick against the wrong model, a backend rejection surfacing as a phantom Failed-to message; using a functional update to check the anchor leaves a still-valid arm untouched, so an ordinary refetch that still carries the anchor never clears the gesture mid-way.

.. CG-EXPLANATION-END id=function:usePairArm

