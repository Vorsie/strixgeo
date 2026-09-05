groundmodel.api.schemas.elevation_patch_request
===============================================

.. CG-PAGE source=src/groundmodel/api/schemas/elevation_patch_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/elevation_patch_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../src/groundmodel/api/schemas/elevation_patch_request.py
   :language: python
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A short docstring saying the schema is shared by the CPT and borehole elevation editors, then imports of Pydantic's field helper and the strict request base.

**Why it is here.** The payload for setting a manual surface elevation is identical for a CPT and a borehole, so one schema serves both endpoints rather than two copies (the project's don't-repeat rule).

.. CG-EXPLANATION-END id=module-header

Class ``ElevationPatchRequest``
-------------------------------

.. CG-BLOCK id=class:ElevationPatchRequest lines=14-39

.. literalinclude:: ../../../src/groundmodel/api/schemas/elevation_patch_request.py
   :language: python
   :lines: 14-39
   :lineno-match:

.. CG-EXPLANATION-START id=class:ElevationPatchRequest

**What this does.** The request body for the manual elevation editor: an ``elevation_m`` (metres, allowed to be empty to clear the value, and range-guarded from -500 to +9000 m) and an optional vertical coordinate-system code ``z_epsg``.

**Why it is here.** It inherits the strict request base, so unknown fields and non-finite numbers are rejected. Setting the elevation to nothing clears it, returning the record to the "needs Z" state so a typo can be undone. The wide range guard catches an obvious slip (below the deepest ocean trench, above Everest) without rejecting real Belgian values. When no vertical system is picked the router substitutes the Belgian mTAW code, because the desktop has no coordinate-system picker today and Belgian imports are all in mTAW (the docstring records this).

.. CG-EXPLANATION-END id=class:ElevationPatchRequest

