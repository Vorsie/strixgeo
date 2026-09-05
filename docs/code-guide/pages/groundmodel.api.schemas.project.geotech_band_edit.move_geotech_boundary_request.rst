groundmodel.api.schemas.project.geotech_band_edit.move_geotech_boundary_request
===============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_band_edit/move_geotech_boundary_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_band_edit/move_geotech_boundary_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/move_geotech_boundary_request.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the schema and imports ``UUID``, ``Field``, and the strict base.

**Why it is here.** A request schema on the strict base; same pattern as the merge request.

.. CG-EXPLANATION-END id=module-header

Class ``MoveGeotechBoundaryRequest``
------------------------------------

.. CG-BLOCK id=class:MoveGeotechBoundaryRequest lines=12-29

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/move_geotech_boundary_request.py
   :language: python
   :lines: 12-29
   :lineno-match:

.. CG-EXPLANATION-START id=class:MoveGeotechBoundaryRequest

**What this does.** The body of the boundary-move (drag) endpoints: the two adjacent bands sharing the boundary and the proposed new boundary depth.

**Why it is here.** The docstring records that the new depth must land strictly inside the pair — squeezing a band to nothing is the ABSORB gesture, which is a merge call, not a move.

.. CG-EXPLANATION-END id=class:MoveGeotechBoundaryRequest

