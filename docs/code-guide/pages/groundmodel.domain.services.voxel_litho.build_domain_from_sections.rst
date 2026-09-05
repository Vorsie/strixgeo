groundmodel.domain.services.voxel_litho.build_domain_from_sections
==================================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/build_domain_from_sections.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/build_domain_from_sections.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/build_domain_from_sections.py
   :language: python
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a small helper that builds the model's lateral footprint from the section partitions the frontend posted, and imports the domain builder it delegates to.

**Why it is here.** The docstring is precise about scope: the labeller needs a domain object only for its footprint (its outline and its inside-or-outside test), not for elevations, because the section partitions already carry the vertical envelope. So the footprint is synthesised entirely from the request payload — the columns' world positions and the region elevations — and no database picks are loaded, which keeps the build-request the single source of truth. The helper was promoted from a private function in an eval script once a second caller (the read-only eval scripts) needed it, following the extract-on-the-second-copy rule.

.. CG-EXPLANATION-END id=module-header

Function ``def build_domain_from_sections``
-------------------------------------------

.. CG-BLOCK id=function:build_domain_from_sections lines=32-109

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/build_domain_from_sections.py
   :language: python
   :lines: 32-109
   :lineno-match:

.. CG-EXPLANATION-START id=function:build_domain_from_sections

**What this does.** Reads the global top and bottom elevation from every region polygon to frame the vertical extent, then collects one map position per investigation and builds the footprint as an alpha hull (a tight outline wrapped around scattered points) through them. Crucially it feeds the hull TWO kinds of position: every section column's projected foot (where the 2-D geometry lives) and, when supplied, every investigation's TRUE drilled map position.

**Why it is here.** The docstring records a real defect this closes. On real data an investigation's projected foot on a section and its true drilled position are metres to tens of metres apart, so a footprint framed from the feet alone leaves boreholes standing outside the model they helped build, and the labeller's footprint gate then skips their grid column entirely — no material at all where the ground was actually drilled. Adding the drilled positions grows the hull to cover them. A comment explains why each true position is stored under a suffixed id: the domain builder keys its bookkeeping by test id, so reusing the bare investigation id would make the true position and the projected foot overwrite each other, collapsing the two distinct map points the hull must span into one. The default of no drilled positions reproduces the older feet-only behaviour byte for byte.

.. CG-EXPLANATION-END id=function:build_domain_from_sections

