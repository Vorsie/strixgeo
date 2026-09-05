groundmodel.domain.services.voxel_litho.voxel_types
===================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/voxel_types.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/voxel_types.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/voxel_types.py
   :language: python
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the file and imports its tools. It defines the small data holders that make up the contract between the frontend and the voxel builder: the shapes the frontend posts (the validated 2-D section partition) and the intermediate labelled grid the builder produces and the mesher consumes. A *dataclass* is a class whose only job is to hold a few named values together; ``@dataclass(frozen=True)`` above one means it is a read-only bundle that cannot be changed after it is made (a *value object*).

**Why it is here.** The docstring states these are pure data containers with no I/O, logging, or framework code, so they carry no logger. It also records the deliberate exception to the project's one-class-per-file rule: all these objects live together because they form one cohesive vocabulary, the build-request contract, in the same spirit as the shared exceptions module. The request-side objects mirror the frontend shapes one-for-one, in snake_case, so they round-trip the network JSON unchanged.

.. CG-EXPLANATION-END id=module-header

Class ``RegionInput``
---------------------

.. CG-BLOCK id=class:RegionInput lines=33-109

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/voxel_types.py
   :language: python
   :lines: 33-109
   :lineno-match:

.. CG-EXPLANATION-START id=class:RegionInput

**What this does.** A read-only holder for one filled region of a 2-D section partition — a single-soil polygon the frontend produced for one gap of one section. It carries the region's formation, its body identity, its outline as ``(fraction, elevation)`` points (where fraction runs 0 at the gap's left column to 1 at its right), the gap it belongs to, how the 2-D engine terminated it (a quad, a pinch, or a lens), and several optional classification fields.

**Why it is here.** This is the atom of the single-source-of-truth geometry: the region is exactly what ``computeSectionFill`` drew, carried across the network without reshaping. The docstring pins several load-bearing decisions. The ``kind`` field records the 2/1/0 gesture (a body on both columns is a band-like quad, on one column a pinch, an enclosed minority a lens). ``tied_band_base`` honours the owner directive that an explicit user correlation is absolute and must not be chopped flat by the shallow-log cap. And ``layer_ids`` names the litho layers, never the bodies, that produced the region, because the body recompute reads this as connectivity evidence and body ids get restamped by the recompute itself — feeding body-labelled evidence back on itself oscillated (dogfeed 2026-08-12). Every classification field is optional so a project saved before these fields existed still loads.

.. CG-EXPLANATION-END id=class:RegionInput

Class ``SectionColumnInput``
----------------------------

.. CG-BLOCK id=class:SectionColumnInput lines=110-136

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/voxel_types.py
   :language: python
   :lines: 110-136
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionColumnInput

**What this does.** A read-only holder for one investigation column of a section: the CPT or borehole it represents, how far along the section line it sits, and its world easting and northing.

**Why it is here.** The docstring explains the world coordinates come straight from the frontend's fence builder, so the backend never re-projects: a gap's fractions map onto the straight line between the two columns' world positions. Storing the position once here keeps the backend and frontend measuring the same geometry.

.. CG-EXPLANATION-END id=class:SectionColumnInput

Class ``SectionPartitionInput``
-------------------------------

.. CG-BLOCK id=class:SectionPartitionInput lines=137-172

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/voxel_types.py
   :language: python
   :lines: 137-172
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionPartitionInput

**What this does.** A read-only holder for one whole section's 2-D partition: the two endpoints of its line, the ordered list of its investigation columns, and the filled regions, each of which names the column pair it fills.

**Why it is here.** This is the per-section unit the frontend posts, so it bundles everything the builder needs to place that section in the world: the line to sit the columns on, the columns themselves in order along the line, and the regions keyed to consecutive column pairs.

.. CG-EXPLANATION-END id=class:SectionPartitionInput

Class ``InvestigationColumn``
-----------------------------

.. CG-BLOCK id=class:InvestigationColumn lines=173-221

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/voxel_types.py
   :language: python
   :lines: 173-221
   :lineno-match:

.. CG-EXPLANATION-START id=class:InvestigationColumn

**What this does.** A read-only holder for one investigation's OWN observed layer stack at its true map position: its id, its true easting and northing, the ordered top-to-bottom body intervals it logged, and whether it is a cone or a borehole.

**Why it is here.** The docstring explains the honoring problem this exists for. An investigation feeds a section at its projected foot on the section line, but its true map position usually sits off to the side, so the between-section blend at the true location can disagree with the investigation's own log. This object carries that log so the builder can honor it at the investigation's own grid column, labelling those voxels from the log within its logged depth range and falling back to the section blend only above the top and below the base, so a shallow log does not punch a hole through the deep fill. The intervals carry the same body identity the sections use, so honored voxels group with the matching bodies in the mesher. The kind defaults to borehole, the conservative choice, so a column of unstated provenance never outranks a cone.

.. CG-EXPLANATION-END id=class:InvestigationColumn

Class ``LabelReport``
---------------------

.. CG-BLOCK id=class:LabelReport lines=222-307

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/voxel_types.py
   :language: python
   :lines: 222-307
   :lineno-match:

.. CG-EXPLANATION-START id=class:LabelReport

**What this does.** A read-only tally of everything the labelling had to paper over, so the caller can say it out loud: how many rim columns were carried by a section that was not the nearest, how many columns inside the footprint no section could fill (holes in a model meant to be gapless), how many near-tie contests were decided on evidence, how many interior voids the two-section blend closed and the tallest of them, how many final columns still carry a gap over the hairline limit and the tallest, which honored logs reach below the grid floor, and the counts that feed the gapless gate.

**Why it is here.** The docstring's reason is that the labeller is a pure function with no logger, and several of these situations are invisible in the grid it returns — a closed void looks like a contact, a truncated log looks like a shallow one, a rescued column looks like any other — so each must be counted here and logged by the application layer. Every field defaults to zero or empty, so a hand-built report reads as nothing to report. A long note distinguishes two column counters that look similar but answer different questions, so the gapless gate measures the array the labeller actually wrote rather than a narrower blend-only count.

.. CG-EXPLANATION-END id=class:LabelReport

Class ``LabelGrid``
-------------------

.. CG-BLOCK id=class:LabelGrid lines=308-365

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/voxel_types.py
   :language: python
   :lines: 308-365
   :lineno-match:

.. CG-EXPLANATION-START id=class:LabelGrid

**What this does.** A read-only holder for the finished labelled grid: the three axis coordinate arrays, the dense 3-D integer array of body indices (with minus one meaning void), the table turning an index back into a body id, the map from a body to its formation, and the report of anomalies. A *numpy array* is a compact rectangular block of numbers the maths libraries process fast; here the labels array holds one integer per voxel.

**Why it is here.** The docstring states the design pillar: this is the intermediate the labeller produces and the mesher consumes, and because a labelling of space is itself a partition, the per-body boundaries the mesher extracts are watertight and faithful by construction. The indexing convention is spelled out exactly so a reader can resolve any voxel to its body and that body to its soil colour without re-walking the section regions. The report defaults to an all-clear so a grid built by hand in a test needs no knowledge of it.

.. CG-EXPLANATION-END id=class:LabelGrid

Class ``SectionReconciliation``
-------------------------------

.. CG-BLOCK id=class:SectionReconciliation lines=366-445

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/voxel_types.py
   :language: python
   :lines: 366-445
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionReconciliation

**What this does.** A read-only holder for one section's per-gap comparison of the 2-D fill against the 3-D grid — the seventh clause of the gapless gate. It carries the swept area each side covered, the exact quantisation budget, how far the two disagree, the total allowance, whether the section failed, and the single worst sample located along the fence with its height discrepancy, plus how many samples fell outside the footprint.

**Why it is here.** The docstring explains the check must be dimensionally sound: a bare area-against-volume comparison has no defensible width, so both sides are measured as a swept area in the vertical plane along the section's own column fence. The budget is derived, not guessed: a run of ground sampled on a grid of a given vertical pitch differs from its true height by at most that pitch, so a disjoint run count times the pitch bounds the error. Because nothing backend-side carries a section's display name, a finding names the section by its index and line endpoints, never a guessed name. The worst-sample fields let a finding name a height discrepancy at a place, not just a total area.

.. CG-EXPLANATION-END id=class:SectionReconciliation

