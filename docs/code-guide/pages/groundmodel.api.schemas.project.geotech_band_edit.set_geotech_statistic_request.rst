groundmodel.api.schemas.project.geotech_band_edit.set_geotech_statistic_request
===============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_band_edit/set_geotech_statistic_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_band_edit/set_geotech_statistic_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/set_geotech_statistic_request.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the schema and imports ``Literal`` (a type that allows only a fixed set of exact values), ``Field``, and the strict base.

**Why it is here.** A request schema; the ``Literal`` restricts the field to a closed set.

.. CG-EXPLANATION-END id=module-header

Class ``SetGeotechStatisticRequest``
------------------------------------

.. CG-BLOCK id=class:SetGeotechStatisticRequest lines=12-25

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/set_geotech_statistic_request.py
   :language: python
   :lines: 12-25
   :lineno-match:

.. CG-EXPLANATION-START id=class:SetGeotechStatisticRequest

**What this does.** The body for changing a geotech model's representative-cone-resistance statistic: one of exactly four tokens (median, arithmetic, harmonic, geometric).

**Why it is here.** The docstring records that the ``Literal`` deliberately duplicates the domain's approved set so an invalid token is rejected at the wire with a ``422`` before any code runs (owner ruling 7).

.. CG-EXPLANATION-END id=class:SetGeotechStatisticRequest

