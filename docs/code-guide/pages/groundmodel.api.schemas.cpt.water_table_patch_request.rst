groundmodel.api.schemas.cpt.water_table_patch_request
=====================================================

.. CG-PAGE source=src/groundmodel/api/schemas/cpt/water_table_patch_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/cpt/water_table_patch_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/water_table_patch_request.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and imports of ``Field`` and the strict base.

**Why it is here.** A request schema, so it inherits the strict base.

.. CG-EXPLANATION-END id=module-header

Class ``WaterTablePatchRequest``
--------------------------------

.. CG-BLOCK id=class:WaterTablePatchRequest lines=10-48

.. literalinclude:: ../../../src/groundmodel/api/schemas/cpt/water_table_patch_request.py
   :language: python
   :lines: 10-48
   :lineno-match:

.. CG-EXPLANATION-START id=class:WaterTablePatchRequest

**What this does.** One field: ``water_depth_m``, the depth to groundwater below ground surface (positive down), optional and range-guarded to -500..500.

**Why it is here.** The docstring carries the domain reasoning: this number drives the whole Robertson normalisation, so setting it stamps the source ENGINEER and a later re-import will not overwrite it (Data Integrity Rule 1). Sending empty clears it — restoring the file's value if the first override snapshotted one, else returning to "nothing recorded". A negative value is allowed for the offshore case where water stands above the collar (owner ruling 2026-08-23); the docstring notes recording it is a provenance gain, not a numerical one, since the stress model already treats 0 and -15 alike. The range guard rejects a depth no CPT ever worked as a typo or corrupt file.

.. CG-EXPLANATION-END id=class:WaterTablePatchRequest

