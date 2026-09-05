groundmodel.api.schemas.dem
===========================

.. CG-PAGE source=src/groundmodel/api/schemas/dem.py complete=true

*Source file:* ``src/groundmodel/api/schemas/dem.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../src/groundmodel/api/schemas/dem.py
   :language: python
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring naming the file's two uses, then imports of Pydantic's base model and field helper and the shared gap-issue schema from the formation-contact package.

**Why it is here.** Groups the schemas for the *digital elevation model* (DEM — the gridded ground-surface heights) in one file: the profile along a drawn section line, and the ground-surface mesh used as the base of the 3-D scene.

.. CG-EXPLANATION-END id=module-header

Class ``DemSamplePointResponse``
--------------------------------

.. CG-BLOCK id=class:DemSamplePointResponse lines=19-29

.. literalinclude:: ../../../src/groundmodel/api/schemas/dem.py
   :language: python
   :lines: 19-29
   :lineno-match:

.. CG-EXPLANATION-START id=class:DemSamplePointResponse

**What this does.** One elevation sample along a section line: a distance ``along_m`` and an ``elevation_m`` that is empty where the underlying grid pixel held no data.

**Why it is here.** An empty elevation is a real, meaningful outcome (outside the coverage area or a known data hole), so the field is explicitly allowed to be empty rather than faked with a number.

.. CG-EXPLANATION-END id=class:DemSamplePointResponse

Class ``DemSampleLineResponse``
-------------------------------

.. CG-BLOCK id=class:DemSampleLineResponse lines=30-41

.. literalinclude:: ../../../src/groundmodel/api/schemas/dem.py
   :language: python
   :lines: 30-41
   :lineno-match:

.. CG-EXPLANATION-START id=class:DemSampleLineResponse

**What this does.** The body returned by ``GET /dem/sample``: which provider answered (``source``) and the list of samples from the start to the end of the requested line.

**Why it is here.** Echoing the source lets the desktop show which elevation dataset produced the profile, which matters when more than one provider can answer.

.. CG-EXPLANATION-END id=class:DemSampleLineResponse

Class ``GroundSurfaceBuildResponse``
------------------------------------

.. CG-BLOCK id=class:GroundSurfaceBuildResponse lines=42-75

.. literalinclude:: ../../../src/groundmodel/api/schemas/dem.py
   :language: python
   :lines: 42-75
   :lineno-match:

.. CG-EXPLANATION-START id=class:GroundSurfaceBuildResponse

**What this does.** The body for the ground-surface build: a flat list of vertex triples, a list of triangle index-triples that join them into a mesh, which provider answered, whether every tile came from the local cache, and a list of validation findings.

**Why it is here.** This is the 3-D viewer's ground base in place of a flat globe. Empty vertex and triangle lists are valid results (no hull could be computed, or too few valid samples), and the findings list surfaces problems such as vertices on no-data cells or formation tops sitting above the ground surface, so the engineer sees a clean build versus one that needs attention.

.. CG-EXPLANATION-END id=class:GroundSurfaceBuildResponse

