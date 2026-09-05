desktop.renderer.src.utils.partitionFillV2.computeSectionFillV2
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/computeSectionFillV2.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/computeSectionFillV2.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-65

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/computeSectionFillV2.ts
   :language: typescript
   :lines: 1-65
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the top-level entry point for the whole second-generation fill: given the section's litho columns and the approved correlation lines, it produces the list of coloured tiles the section is drawn from. It runs the pipeline -- normalise the input, emit the four families of curves, build the planar arrangement and trace faces, label each face with a soil and body, then cut the faces at the column lines into one polygon per gap.

**Why it is here.** The docstring pins that this keeps the exact same signature and output shape as the first-generation ``computeSectionFill`` so nothing downstream had to change (design section 5). The plain entry returns just the tiles; a second entry also returns detected crossing-tie conflicts for the warning surface. Pure module.

.. CG-EXPLANATION-END id=module-header

``function computeSectionFillV2``
---------------------------------

.. CG-BLOCK id=function:computeSectionFillV2 lines=66-81

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/computeSectionFillV2.ts
   :language: typescript
   :lines: 66-81
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeSectionFillV2

**What this does.** The plain public function: takes the columns, the approved edges, optional per-body drag overrides and the optional real along-section metres, and returns just the list of tiles.

**Why it is here.** The docstring flags ``alongM`` as load-bearing -- uniform spacing diverges from real spacing -- and notes empty columns are dropped; it is a thin drop-in wrapper over the with-conflicts version.

.. CG-EXPLANATION-END id=function:computeSectionFillV2

``function computeSectionFillV2WithConflicts``
----------------------------------------------

.. CG-BLOCK id=function:computeSectionFillV2WithConflicts lines=82-92

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/computeSectionFillV2.ts
   :language: typescript
   :lines: 82-92
   :lineno-match:

.. CG-EXPLANATION-START id=function:computeSectionFillV2WithConflicts

**What this does.** The same computation, but returns the tiles PLUS the detected crossing-tie conflicts and the review flags (the drilled units the safe-default repair had to rescue).

**Why it is here.** Crossing approved ties are a hard conflict the UI must warn about (owner section 8 question 4); this surfaces that data alongside the fill without forcing every caller to receive it.

.. CG-EXPLANATION-END id=function:computeSectionFillV2WithConflicts

``function toReviewFlags``
--------------------------

.. CG-BLOCK id=function:toReviewFlags lines=93-121

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/computeSectionFillV2.ts
   :language: typescript
   :lines: 93-121
   :lineno-match:

.. CG-EXPLANATION-START id=function:toReviewFlags

**What this does.** Turns the repair pass's forced-lens key strings into structured review-flag records, dropping any that fail to parse.

**Why it is here.** The repair records which drilled units it rescued as opaque keys; this converts them to the shape other code reads, discarding malformed ones defensively.

.. CG-EXPLANATION-END id=function:toReviewFlags

``type OverrideOutcome``
------------------------

.. CG-BLOCK id=type:OverrideOutcome lines=122-142

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/computeSectionFillV2.ts
   :language: typescript
   :lines: 122-142
   :lineno-match:

.. CG-EXPLANATION-START id=type:OverrideOutcome

**What this does.** A four-way result type describing what happened to a free-draw drag: applied (a safe reshape, tiles carry the new shape), rejected-unsafe (every variant opened a hole or overlap worse than the base, so the un-reshaped fill stands and the defect areas are reported), rejected-collapse (the drag was safe but destroyed its own grab handle by over-reaching a column, so it snaps back), and unsupported (no drag present). The block also re-exports the ``FillIdentity`` view from its own module so consumers resolve it from here.

**Why it is here.** The docstring explains the design goal: the never-a-gap-or-overlap invariant holds by construction, which means an unsafe drag silently degrades to the base fill -- and before this type that degradation was silent, the handle moving while the body did not. The tri-state makes every drag traceable, and the rejected-collapse case encodes the owner's 2026-07-23 lock (only over-reach snaps back), distinguishing a tip that validly vanishes within the gap from one that destroyed its handle by over-reaching.

.. CG-EXPLANATION-END id=type:OverrideOutcome

``type FillPass``
-----------------

.. CG-BLOCK id=type:FillPass lines=143-172

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/computeSectionFillV2.ts
   :language: typescript
   :lines: 143-172
   :lineno-match:

.. CG-EXPLANATION-START id=type:FillPass

**What this does.** A type holding the result of one fill pass: the sliced tiles, the merged tiles (same-soil touching tiles welded into one body), the conflicts, the list of repaired units, the pass's normalised columns and its raw picked-unit contacts.

**Why it is here.** The docstring explains the two carried extras -- the normalised columns so a later identity merge uses the same per-gap tolerance the display merge used, and the raw contacts so the identity path can still say what was drilled here after the merge spliced a unit out.

.. CG-EXPLANATION-END id=type:FillPass

``let baseFillCache``
---------------------

.. CG-BLOCK id=let:baseFillCache lines=173-188

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/computeSectionFillV2.ts
   :language: typescript
   :lines: 173-188
   :lineno-match:

.. CG-EXPLANATION-START id=let:baseFillCache

**What this does.** A one-entry memory of the no-override base pass -- the columns, edges, spacing and engine flag it was computed for, and the resulting pass.

**Why it is here.** The docstring gives the measured reason: the ghost-handle probe calls the classifier once per grab handle (70 times on CS1), each with a different single drag but the SAME columns, so every call recomputed the identical base pass and doubled the probe's cost; caching it by input identity removes that. A caller that rebuilds its arrays simply misses and recomputes -- slow, never wrong.

.. CG-EXPLANATION-END id=let:baseFillCache

``function cachedBaseFill``
---------------------------

.. CG-BLOCK id=function:cachedBaseFill lines=189-207

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/computeSectionFillV2.ts
   :language: typescript
   :lines: 189-207
   :lineno-match:

.. CG-EXPLANATION-START id=function:cachedBaseFill

**What this does.** Returns the no-override base pass for these inputs, computing it once and reusing it on a match keyed by input identity plus the engine flag.

**Why it is here.** A straight helper around the cache above; it invokes the caller's own fill closure only on a miss.

.. CG-EXPLANATION-END id=function:cachedBaseFill

``function classifyOverrideOutcome``
------------------------------------

.. CG-BLOCK id=function:classifyOverrideOutcome lines=208-352

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/computeSectionFillV2.ts
   :language: typescript
   :lines: 208-352
   :lineno-match:

.. CG-EXPLANATION-START id=function:classifyOverrideOutcome

**What this does.** The core routine that runs the fill and classifies a drag. It defines one ``runFill`` closure (normalise, emit, arrange, label, slice, merge -- plus the safe-default repair loop when the two-sided flag is on), then: with no drag it returns the byte-identical single pass as unsupported; with a drag it computes the no-override base, aliases the drag across the merged body component, and picks the first variant (aliased, else direct) whose defect area does not exceed the base -- returning applied, or rejected-collapse if it destroyed its own handle by over-reaching, or rejected-unsafe if every variant opened a hole.

**Why it is here.** The inline comments carry the two owner rulings the function enforces. The safe-default repair (2026-07-26, re-ruled 2026-09-04 zero ties = lens) re-runs the fill with any flooded drilled unit forced to a lens, up to three iterations, so clean cases are byte-identical to the pre-repair engine. The override aliasing (2026-07-22) exists because the app keys a drag on the rendered body id while the engine emits per raw unit, so a base pass reveals the render-to-raw equivalence and the drag is routed to every raw body in the component; each variant is self-validated against the base defect area so never-a-gap-or-overlap stays a hard invariant while the degradation is now explicit rather than silent.

.. CG-EXPLANATION-END id=function:classifyOverrideOutcome

``const REPAIR_ITERS``
----------------------

.. CG-BLOCK id=const:REPAIR_ITERS lines=353-355

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/computeSectionFillV2.ts
   :language: typescript
   :lines: 353-355
   :lineno-match:

.. CG-EXPLANATION-START id=const:REPAIR_ITERS

**What this does.** The cap of 3 on how many times the safe-default repair may re-run before accepting the best result so far.

**Why it is here.** The repair accumulates flooded units across passes to a fixed point; the cap bounds it so it always terminates.

.. CG-EXPLANATION-END id=const:REPAIR_ITERS

``const HOLE_AREA_EPS``
-----------------------

.. CG-BLOCK id=const:HOLE_AREA_EPS lines=356-364

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/computeSectionFillV2.ts
   :language: typescript
   :lines: 356-364
   :lineno-match:

.. CG-EXPLANATION-START id=const:HOLE_AREA_EPS

**What this does.** A one-thousandth-of-a-square-metre tolerance: a drag variant must not exceed the no-override base's hole area by more than this to count as safe.

**Why it is here.** It gives the defect comparison a float-noise margin so an identical fill is not rejected over rounding.

.. CG-EXPLANATION-END id=const:HOLE_AREA_EPS

``const COLLAPSE_TIP_FRACTION_EPS``
-----------------------------------

.. CG-BLOCK id=const:COLLAPSE_TIP_FRACTION_EPS lines=365-375

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/computeSectionFillV2.ts
   :language: typescript
   :lines: 365-375
   :lineno-match:

.. CG-EXPLANATION-START id=const:COLLAPSE_TIP_FRACTION_EPS

**What this does.** A fraction tolerance (0.02): a vertex within this of a column edge counts as touching that column.

**Why it is here.** The comment explains it mirrors the overlay helper's own value and is deliberately duplicated rather than imported, because this classifier lives in the ``utils`` layer and must not import from the ``components`` layer (the one-way dependency rule).

.. CG-EXPLANATION-END id=const:COLLAPSE_TIP_FRACTION_EPS

``function isApexShapeableRegion``
----------------------------------

.. CG-BLOCK id=function:isApexShapeableRegion lines=376-422

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/computeSectionFillV2.ts
   :language: typescript
   :lines: 376-422
   :lineno-match:

.. CG-EXPLANATION-START id=function:isApexShapeableRegion

**What this does.** Decides whether a tile is a reshapeable termination (a lens, or a pinch or quad with a tip strictly inside the gap that does not already span the full width) as opposed to a full-width band with no free tip.

**Why it is here.** The rejected-collapse test needs to know whether the edited body flooded to a bandlike shape; this is the ``utils``-layer copy of the overlay's shapeability check.

.. CG-EXPLANATION-END id=function:isApexShapeableRegion

``function isCollapseOverReach``
--------------------------------

.. CG-BLOCK id=function:isCollapseOverReach lines=423-446

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/computeSectionFillV2.ts
   :language: typescript
   :lines: 423-446
   :lineno-match:

.. CG-EXPLANATION-START id=function:isCollapseOverReach

**What this does.** Returns true when some drag in the pass both over-reached a column edge (its raw fraction fell outside 0 to 1) AND flooded the edited body to a full-width band -- meaning the drag destroyed its own grab handle.

**Why it is here.** The docstring works through why BOTH conditions are required: a tip that merely vanishes within the gap (raw fraction still in range, a neighbour fills its place) is a valid reshape, and a full-width flood with no over-reach is a legitimate band; only the aggressive drag that over-reaches a column AND floods its own body snaps back, which is the owner's 2026-07-23 lock. It also notes the raw fraction is absent on the persisted-render path, so that path never trips this.

.. CG-EXPLANATION-END id=function:isCollapseOverReach

``function coveredIntervalsAt``
-------------------------------

.. CG-BLOCK id=function:coveredIntervalsAt lines=447-471

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/computeSectionFillV2.ts
   :language: typescript
   :lines: 447-471
   :lineno-match:

.. CG-EXPLANATION-START id=function:coveredIntervalsAt

**What this does.** Returns the elevation intervals of one polygon covered at a given fraction across the gap, by finding where the polygon's edges cross that vertical line and pairing the crossings top to bottom.

**Why it is here.** It is the primitive the defect scan uses to measure coverage at a sample line.

.. CG-EXPLANATION-END id=function:coveredIntervalsAt

``function sectionDefectArea``
------------------------------

.. CG-BLOCK id=function:sectionDefectArea lines=472-504

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/computeSectionFillV2.ts
   :language: typescript
   :lines: 472-504
   :lineno-match:

.. CG-EXPLANATION-START id=function:sectionDefectArea

**What this does.** Returns a rough defect-area number for a set of tiles: it scans each gap at coarse fraction steps and sums both the interior coverage holes and the different-soil overlaps.

**Why it is here.** The docstring notes the override self-validation only needs is-this-variant-worse-than-the-base, not an exact area, so a coarse 0.05 scan is enough and cheap; same-soil lens-over-matrix overlaps are excluded because they share a formation and are not a torn partition.

.. CG-EXPLANATION-END id=function:sectionDefectArea

