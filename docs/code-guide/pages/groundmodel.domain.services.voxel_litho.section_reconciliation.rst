groundmodel.domain.services.voxel_litho.section_reconciliation
==============================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/section_reconciliation.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/section_reconciliation.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-86

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/section_reconciliation.py
   :language: python
   :lines: 1-86
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces clause 7 of the gapless gate, which checks that the 2-D section fill and the 3-D label grid agree. It compares two AREAS swept along the same vertical plane, the section's own column fence: the classed area of the 2-D fill and the labelled area of the 3-D grid, both in square metres. It imports numpy, the model footprint, the labeller's own slicing helper, the footprint tolerance, the reconciliation tolerance and the value objects.

**Why it is here.** A naive area-versus-volume comparison is dimensionally wobbly, because an area has no defensible width to become a volume, so the honest check compares two areas measured the same way. The long docstring records the exact per-gap recipe: sample each gap at cell-centred fractions so no sample lands on a column, take the UNION of the 2-D intervals rather than sum them (the fill is meant to be disjoint, but the measurement must not assume the thing it is checking), count the labelled voxels on the 3-D side, and exclude any point outside the footprint from BOTH sides so 'unknown against unknown' is never scored as agreement. It stresses that the sections must be read in the RE-SEATED payload the labeller used, or the two sides would compare different models, and that on a section's own fence the blend weight is exactly one, so the 3-D side is checking the right section's material there. A pure function, so nothing inherits the logging base.

.. CG-EXPLANATION-END id=module-header

Function ``def _union_length``
------------------------------

.. CG-BLOCK id=function:_union_length lines=87-113

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/section_reconciliation.py
   :language: python
   :lines: 87-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:_union_length

**What this does.** Merges a list of elevation intervals (each a base-below-top pair) into their non-overlapping union and returns the total length plus how many separate runs remain, merging any that touch or overlap.

**Why it is here.** The 2-D fill is meant to be disjoint, but the reconciliation must not assume the very property it is checking, so it takes the union rather than a plain sum: two regions that wrongly overlap must not be double-counted. The run count feeds the exact rounding budget, since each separate run can be off by at most one voxel height. A private helper.

.. CG-EXPLANATION-END id=function:_union_length

Function ``def reconcile_sections``
-----------------------------------

.. CG-BLOCK id=function:reconcile_sections lines=114-233

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/section_reconciliation.py
   :language: python
   :lines: 114-233
   :lineno-match:

.. CG-EXPLANATION-START id=function:reconcile_sections

**What this does.** For every section with at least two columns, walks each gap between consecutive columns, samples it at cell-centred points, and at each point measures the 2-D fill height (the union of that gap's regions sliced at the sample) and the 3-D grid height (the count of labelled voxels at the nearest grid column times the cell height). It adds up the swept 2-D area, the swept 3-D area and the exact rounding budget, excludes any sample outside the footprint from both sides, tracks the worst single-sample divergence, and returns one reconciliation record per section flagging whether the total divergence exceeds the allowed budget plus slack.

**Why it is here.** This is the measurable form of the rule that the 3-D model must neither lose nor invent ground relative to the 2-D fill the engineer validated. It reads the re-seated payload the labeller used, uses the labeller's own slicing helper and the same footprint gate, so the two sides are the same model. It samples at cell-centred fractions so adjacent gaps never double-count the column they share, and it adds the five-percent owner-calibration slack on top of the exact rounding budget. A single-column section has no gap to sample and is skipped.

.. CG-EXPLANATION-END id=function:reconcile_sections

