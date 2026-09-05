groundmodel.api.schemas.project.geotech_band_edit.geotech_statistic_response
============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_band_edit/geotech_statistic_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_band_edit/geotech_statistic_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/geotech_statistic_response.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the schema and imports the Pydantic tools.

**Why it is here.** A response schema; same pattern.

.. CG-EXPLANATION-END id=module-header

Class ``GeotechStatisticResponse``
----------------------------------

.. CG-BLOCK id=class:GeotechStatisticResponse lines=8-29

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/geotech_statistic_response.py
   :language: python
   :lines: 8-29
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechStatisticResponse

**What this does.** The model's representative-cone-resistance statistic state after a change: the choice now stored, what the last full subdivision classified with, and a server-computed flag saying the two differ.

**Why it is here.** The docstring (owner rulings 7 and 8) records that ``bands_stale`` is derived on every read, never stored, so it self-clears when a rebuild stamps the new statistic or the choice is flipped back — the toolbar uses it to offer a re-subdivide.

.. CG-EXPLANATION-END id=class:GeotechStatisticResponse

