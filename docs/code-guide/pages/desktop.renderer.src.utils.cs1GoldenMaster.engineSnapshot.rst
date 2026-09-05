desktop.renderer.src.utils.cs1GoldenMaster.engineSnapshot
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/cs1GoldenMaster/engineSnapshot.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/cs1GoldenMaster/engineSnapshot.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/engineSnapshot.ts
   :language: typescript
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the first half of the golden master: what the ENGINE derives from the database for CS1 — every region the geotech fill emits, with its gap, class, kind, carried layers and its full polygon, plus the litho fallback ("correlate me") regions. It imports the real pipeline pieces so the snapshot is of the shipped path. It is a pure module with no on-screen React.

**Why it is here.** The docstring records the owner's instruction to freeze all quads (2026-08-23: "make sure to have all quads too") and, crucially, why one half is not enough: on 2026-08-22 the engine output was proved byte-identical across a night's work while three render layers changed what reached the screen. That is the whole reason the gate has a second, on-screen half.

.. CG-EXPLANATION-END id=module-header

``const QUANTUM``
-----------------

.. CG-BLOCK id=const:QUANTUM lines=34-35

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/engineSnapshot.ts
   :language: typescript
   :lines: 34-35
   :lineno-match:

.. CG-EXPLANATION-START id=const:QUANTUM

**What this does.** The rounding grain (one million, i.e. round to six decimal places) applied to fractions and elevations before they are frozen.

**Why it is here.** The docstring picks it deliberately: far finer than the engine's own 1 mm snap, so a real geometry change can never hide under it, yet coarse enough that the golden does not churn on last-bit floating-point noise between machines.

.. CG-EXPLANATION-END id=const:QUANTUM

``const round``
---------------

.. CG-BLOCK id=const:round lines=36-38

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/engineSnapshot.ts
   :language: typescript
   :lines: 36-38
   :lineno-match:

.. CG-EXPLANATION-START id=const:round

**What this does.** Rounds one number to the ``QUANTUM`` grain.

**Why it is here.** A one-line helper so every frozen coordinate is rounded the same way.

.. CG-EXPLANATION-END id=const:round

``interface FrozenRegion``
--------------------------

.. CG-BLOCK id=interface:FrozenRegion lines=39-48

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/engineSnapshot.ts
   :language: typescript
   :lines: 39-48
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FrozenRegion

**What this does.** One region reduced to everything that decides what it is and where it is: its gap, soil, kind, sorted layer ids, and its ring written as ``fraction,elevation`` pairs in emission order.

**Why it is here.** Freezing exactly these fields means the golden captures the region's identity and shape and nothing incidental, so a diff points at a real change.

.. CG-EXPLANATION-END id=interface:FrozenRegion

``interface EngineSnapshot``
----------------------------

.. CG-BLOCK id=interface:EngineSnapshot lines=49-65

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/engineSnapshot.ts
   :language: typescript
   :lines: 49-65
   :lineno-match:

.. CG-EXPLANATION-START id=interface:EngineSnapshot

**What this does.** The engine half of the golden master: the frozen classed regions and the frozen litho-fallback regions.

**Why it is here.** The fallback regions are kept alongside the classed ones because, as the module docstring says, an unclassed "correlate me" patch is just as much a statement about the model as a classed one.

.. CG-EXPLANATION-END id=interface:EngineSnapshot

``function canonicalRing``
--------------------------

.. CG-BLOCK id=function:canonicalRing lines=66-73

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/engineSnapshot.ts
   :language: typescript
   :lines: 66-73
   :lineno-match:

.. CG-EXPLANATION-START id=function:canonicalRing

**What this does.** Turns a polygon into a single canonical string of rounded points, rotated to start at the smallest point, so only its SHAPE is frozen and not which vertex happened to be emitted first. It does NOT normalise winding direction.

**Why it is here.** The docstring explains a polygon is a cycle and the first-emitted vertex says nothing about what the user sees — the very first run caught a ring identical but rotated by four vertices, and freezing raw order would make the gate cry wolf. Direction is left un-normalised on purpose, because a winding flip is a real change to the emitted path.

.. CG-EXPLANATION-END id=function:canonicalRing

``const freeze``
----------------

.. CG-BLOCK id=const:freeze lines=74-88

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/engineSnapshot.ts
   :language: typescript
   :lines: 74-88
   :lineno-match:

.. CG-EXPLANATION-START id=const:freeze

**What this does.** Reduces one live region to a ``FrozenRegion``: its gap, soil, kind, its layer ids sorted, and its ring canonicalised.

**Why it is here.** Sorting the layer ids and canonicalising the ring strip away incidental ordering so only meaningful identity and shape are frozen.

.. CG-EXPLANATION-END id=const:freeze

``const stable``
----------------

.. CG-BLOCK id=const:stable lines=89-108

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/engineSnapshot.ts
   :language: typescript
   :lines: 89-108
   :lineno-match:

.. CG-EXPLANATION-START id=const:stable

**What this does.** Sorts a list of frozen regions into a fixed order by gap, then soil, then kind, then ring, so the order does not depend on how the engine happened to emit them.

**Why it is here.** The docstring notes the engine is free to emit in any order and only the SET of regions is a statement about the model, so sorting on content makes a pure reordering pass the gate while any real change to a shape, class or layer set still fails it.

.. CG-EXPLANATION-END id=const:stable

``function computeEngineSnapshot``
----------------------------------

.. CG-BLOCK id=function:computeEngineSnapshot lines=109-138

.. literalinclude:: ../../../desktop/src/renderer/src/utils/cs1GoldenMaster/engineSnapshot.ts
   :language: typescript
   :lines: 109-138
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeEngineSnapshot

**What this does.** Runs the real pipeline over the frozen CS1 scene: it computes the litho partition with its apex overrides, feeds that plus the frame-aligned geotech columns into the hierarchical geotech fill, and returns the classed and fallback regions each frozen and stably sorted.

**Why it is here.** The docstring stresses it mirrors the render's own call sequence exactly, so the snapshot is of the shipped path and not a test-only arrangement — the point of a golden master is that it freezes what really ships.

.. CG-EXPLANATION-END id=function:computeEngineSnapshot

