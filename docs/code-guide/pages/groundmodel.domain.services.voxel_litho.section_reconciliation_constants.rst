groundmodel.domain.services.voxel_litho.section_reconciliation_constants
========================================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/section_reconciliation_constants.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/section_reconciliation_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/section_reconciliation_constants.py
   :language: python
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Defines one number: the extra relative slack, five percent, added on top of the exact vertical-rounding budget when clause 7 of the gapless gate checks that the 2-D section fill and the 3-D label grid agree.

**Why it is here.** The gate's other term is derived and exact: a run of ground sampled on a grid of a given cell height can differ from its true height by at most one cell. This second term is not derived; it is an unmeasured allowance for three effects the docstring names: the small horizontal offset between a sample point and the nearest grid node, the honoured-borehole cells that legitimately override the section fill near an investigation, and the blend zone where a crossing section is nearly as close as the one that drew the fill. The docstring is explicit that five percent is a starting point chosen so a clean model passes comfortably, and that it is owner-calibration-pending: it must be re-set against the first real build, not treated as a settled figure. A pure constants module that holds a value and does not act.

.. CG-EXPLANATION-END id=module-header

