desktop.renderer.src.utils.frameAlignedPartition
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/frameAlignedPartition.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/frameAlignedPartition.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../desktop/src/renderer/src/utils/frameAlignedPartition.ts
   :language: typescript
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file lets one model's section partition be assembled on another model's column axis — specifically, the geotech fill built on the litho model's column frame. The comment tells the whole story: a borehole the packing pipeline has not divided yet has litho layers but no packing bands, so the shared column assembly dropped it, the geotech partition ended up built over fewer columns than the litho frame, the two gap axes stopped lining up index-for-index, and that single misalignment produced three visible symptoms at once — weird polygons answering to no column, the litho clip being skipped, and the "correlate me" texture having nothing to draw over. It imports the partition types and one apex-override helper from the shared section-partition module.

**Why it is here.** The fix is recorded in the comment and is structural. Because the engine itself cannot carry an empty column (it drops it and re-indexes the gaps, which is the very re-indexing that caused the trouble), the frame axis is honoured outside the engine: the frame's columns are split into stretches of consecutive banded columns, each stretch is partitioned on its own, and its output is shifted back onto the frame's gap positions. A gap touching an un-banded column then gets no packing geometry at all, which is the honest answer — nothing was classified there — and the litho clip resolves it to bare ground the texture marks. It is pure geometry bookkeeping with no input/output; the caller owns the engine and does the caching.

.. CG-EXPLANATION-END id=module-header

``interface FrameGapRun``
-------------------------

.. CG-BLOCK id=interface:FrameGapRun lines=36-68

.. literalinclude:: ../../../desktop/src/renderer/src/utils/frameAlignedPartition.ts
   :language: typescript
   :lines: 36-68
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FrameGapRun

**What this does.** Describes one run of consecutive banded columns placed on the frame's axis: the run's columns (always at least two), their along-section distances in metres paired one-to-one with the columns, and an ``offset`` — the frame index of the run's first column.

**Why it is here.** Because a gap sits between two columns, the frame index of the first column is also the frame gap index of the run's first gap, which is exactly what the later shift functions need to move run-local results back onto the frame's gaps. Carrying the offset with the run keeps that mapping in one place.

.. CG-EXPLANATION-END id=interface:FrameGapRun

``function frameAlignedColumns``
--------------------------------

.. CG-BLOCK id=function:frameAlignedColumns lines=69-101

.. literalinclude:: ../../../desktop/src/renderer/src/utils/frameAlignedPartition.ts
   :language: typescript
   :lines: 69-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:frameAlignedColumns

**What this does.** Places a model's columns onto the frame's column axis. For each frame column in order it returns the model's own column when one exists for that investigation, otherwise a stand-in carrying the frame column's identity and collar elevation with an empty layer stack. A model column that is not part of the frame is dropped.

**Why it is here.** This produces exactly one entry per frame column, in the frame's order, so the two axes line up index-for-index — the property whose absence caused the misalignment bug. Dropping a non-frame column enforces "nothing may exceed the frame"; the docstring notes that for the geotech axis such a column cannot arise anyway, since a packing band is always derived from a litho unit and so its investigation always carries litho layers.

.. CG-EXPLANATION-END id=function:frameAlignedColumns

``function frameGapRuns``
-------------------------

.. CG-BLOCK id=function:frameGapRuns lines=102-144

.. literalinclude:: ../../../desktop/src/renderer/src/utils/frameAlignedPartition.ts
   :language: typescript
   :lines: 102-144
   :lineno-match:

.. CG-EXPLANATION-START id=function:frameGapRuns

**What this does.** Splits the frame-aligned column list into the runs the engine can partition. It walks the columns and gathers each maximal stretch of consecutive columns that all carry layers, emitting a run only when the stretch spans at least one gap (two or more columns). The loop runs one step past the end so a run reaching the last column is closed by the same branch as one interrupted by an empty column.

**Why it is here.** A lone banded column sitting between two empty ones has no gap to fill, so it is not emitted; only stretches wide enough to contain a gap become runs. The one-past-the-end trick is a small comment-noted tidiness so there is a single closing path rather than a duplicated one.

.. CG-EXPLANATION-END id=function:frameGapRuns

``function shiftRegionGaps``
----------------------------

.. CG-BLOCK id=function:shiftRegionGaps lines=145-153

.. literalinclude:: ../../../desktop/src/renderer/src/utils/frameAlignedPartition.ts
   :language: typescript
   :lines: 145-153
   :lineno-match:

.. CG-EXPLANATION-START id=function:shiftRegionGaps

**What this does.** Moves a run's output regions back onto the frame's gap axis by adding the run's offset to each region's gap index. An offset of zero returns the caller's own objects untouched.

**Why it is here.** The engine numbers gaps locally within each run; adding the offset restores the frame numbering. The zero-offset shortcut means a single full-width run — every column banded, which is every call from the litho axis — comes out byte-for-byte identical to calling the engine directly, so the new machinery changes nothing on the common path.

.. CG-EXPLANATION-END id=function:shiftRegionGaps

``interface GapIndexed``
------------------------

.. CG-BLOCK id=interface:GapIndexed lines=154-173

.. literalinclude:: ../../../desktop/src/renderer/src/utils/frameAlignedPartition.ts
   :language: typescript
   :lines: 154-173
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GapIndexed

**What this does.** Names the one field the shift needs: a ``gapIndex`` number. It is the minimal shape of any diagnostic that carries a gap index.

**Why it is here.** Declaring just the field the shift touches lets the next function work on any diagnostic type that has a gap index, without caring what else it carries.

.. CG-EXPLANATION-END id=interface:GapIndexed

``function shiftGapIndexed``
----------------------------

.. CG-BLOCK id=function:shiftGapIndexed lines=174-202

.. literalinclude:: ../../../desktop/src/renderer/src/utils/frameAlignedPartition.ts
   :language: typescript
   :lines: 174-202
   :lineno-match:

.. CG-EXPLANATION-START id=function:shiftGapIndexed

**What this does.** Shifts any gap-indexed diagnostic — crossing conflicts, review flags — onto the frame's gap axis the same way regions are shifted, by adding the run's offset to each item's gap index. Offset zero returns the caller's own objects.

**Why it is here.** Diagnostics are numbered against the same run-local gaps as the regions, so they must be re-based the same way or they would point at the wrong gap on the frame. Using a *generic type* ``<T>`` — a placeholder the caller fills in — lets one function serve every diagnostic shape that carries a gap index.

.. CG-EXPLANATION-END id=function:shiftGapIndexed

``function rebaseApexOverrides``
--------------------------------

.. CG-BLOCK id=function:rebaseApexOverrides lines=203-221

.. literalinclude:: ../../../desktop/src/renderer/src/utils/frameAlignedPartition.ts
   :language: typescript
   :lines: 203-221
   :lineno-match:

.. CG-EXPLANATION-START id=function:rebaseApexOverrides

**What this does.** Re-keys the lens-apex overrides from the frame's gap axis onto one run's local gap axis. Override keys look like ``<bodyId>@<gapIndex>``; for each key it splits on the last ``@`` (so a body id that itself contains an ``@`` still resolves), reads the frame gap number, converts it to the run-local gap by subtracting the offset, drops anything falling outside this run, and re-builds the key on the local gap. It returns the caller's own map untouched when the run starts at gap 0 and holds no overrides.

**Why it is here.** The handles that set apex overrides live on the frame's gaps, but each run only understands its own gaps, so its slice of the overrides has to be translated and everything outside the run discarded. Splitting on the last ``@`` is the comment-noted guard against body ids that contain the separator, and the untouched-map shortcut keeps the common litho-axis path free of copying.

.. CG-EXPLANATION-END id=function:rebaseApexOverrides

