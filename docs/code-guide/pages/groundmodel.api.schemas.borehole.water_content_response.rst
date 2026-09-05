groundmodel.api.schemas.borehole.water_content_response
=======================================================

.. CG-PAGE source=src/groundmodel/api/schemas/borehole/water_content_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/borehole/water_content_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/water_content_response.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and the date/UUID/BaseModel/ConfigDict imports.

**Why it is here.** The response-schema pattern for one lab family.

.. CG-EXPLANATION-END id=module-header

Class ``WaterContentResponse``
------------------------------

.. CG-BLOCK id=class:WaterContentResponse lines=9-22

.. literalinclude:: ../../../src/groundmodel/api/schemas/borehole/water_content_response.py
   :language: python
   :lines: 9-22
   :lineno-match:

.. CG-EXPLANATION-START id=class:WaterContentResponse

**What this does.** Water content as a percentage of dry mass, plus method, test date, and id.

**Why it is here.** The docstring warns that values can exceed 100 % for organic soils, peats, and quick clays, and that the domain already validates the range, so consumers must not clamp — a domain fact the reader will recognise.

.. CG-EXPLANATION-END id=class:WaterContentResponse

