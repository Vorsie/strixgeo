groundmodel.domain.services.voxel_litho.snap_grid
=================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/snap_grid.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/snap_grid.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-58

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/snap_grid.py
   :language: python
   :lines: 1-58
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Sets the tolerances used when the backend reads the 2-D partition polygons, and works a function that turns one of them into a gap-local fraction. The frontend snaps every polygon corner to a one-millimetre grid measured in *metres*, but the backend reads those polygons in *gap-local fraction* space, where 0 is the gap's left column and 1 its right column. One millimetre is therefore a different fraction on every gap: nearly nine hundredths of a thousandth across an 11 m gap, but only three millionths across a 333 m one. So a region drawn the whole way across a gap comes back at 0.99991, not at a clean 1.0, and any single fixed fraction tolerance is wrong on some gap.

**Why it is here.** This is the fix for debt #259, and the docstring measures what the bug cost: on the owner's real payload, 33 of 69 gaps carried no polygon corner within a millionth of fraction 1, so a fixed nudge landed *beyond* the last region's edge, the scanline found nothing, and the build silently dropped a whole section's contribution. The rule lives in one place because it has two consumers that must agree — the scanline nudge in ``label_voxels`` and the does-this-region-reach-the-column test in ``merge_bodies_across_sections`` — and the second one, written before #259 was found, had kept the wrong fixed tolerance.

.. CG-EXPLANATION-END id=module-header

Function ``def gap_edge_fraction_margin``
-----------------------------------------

.. CG-BLOCK id=function:gap_edge_fraction_margin lines=59-86

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/snap_grid.py
   :language: python
   :lines: 59-86
   :lineno-match:

.. CG-EXPLANATION-START id=function:gap_edge_fraction_margin

**What this does.** Given a gap's true width in metres, returns the gap-local fraction that covers the required number of snap cells at that width. It floors the answer so it never drops below the slicer's own resolution, and caps it just under one half.

**Why it is here.** The width must be the columns' true world distance, not their drawn ``along_m`` distance, because a section whose columns were re-seated onto their drilled positions has the two disagree. Two snap cells rather than one are cleared, the docstring explains, because a corner can be snapped away from the column edge by up to a full cell and the scanline then has to land strictly inside what is left. The cap just under a half is a real safety guard: a degenerate gap (two columns at the same map point, or the one-to-three millimetres apart that a paired station can be) would otherwise give a margin past the gap's own midpoint, and clamping a fraction between the margin and one-minus-the-margin would invert to a negative fraction and silently drop the section's stack — which is exactly #259's own signature, reachable through #259's own fix.

.. CG-EXPLANATION-END id=function:gap_edge_fraction_margin

