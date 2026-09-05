groundmodel.api.schemas.project.section_geometry_export_request
===============================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/section_geometry_export_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/section_geometry_export_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/section_geometry_export_request.py
   :language: python
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring explaining why these exports are POSTs, then imports the partition sub-schema and the strict base class.

**Why it is here.** The docstring records the key decision: the D-Stability and D-Sheet Piling exports need the section's filled polygons, and the fill is computed in the desktop renderer, never re-derived on the backend — so they are POSTs carrying the drawn partition, unlike the GET-based DXF/Plaxis/PDF exports that need only the picks. Requiring the partition rather than defaulting it is deliberate: a backend approximation would be a second, different geometry disagreeing with the section on screen, so Pydantic answers ``422`` when it is absent, which is the honest outcome.

.. CG-EXPLANATION-END id=module-header

Class ``SectionGeometryExportRequest``
--------------------------------------

.. CG-BLOCK id=class:SectionGeometryExportRequest lines=27-42

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/section_geometry_export_request.py
   :language: python
   :lines: 27-42
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionGeometryExportRequest

**What this does.** The body for a closed-geometry export: the one section's drawn partition, exactly as the renderer produced it.

**Why it is here.** It reuses the same partition shape the 3-D voxel build already sends, so the desktop reuses its existing partition builder unchanged (the don't-repeat rule).

.. CG-EXPLANATION-END id=class:SectionGeometryExportRequest

