groundmodel.api.schemas.project.geotech_band_edit.set_geotech_band_class_request
================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_band_edit/set_geotech_band_class_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_band_edit/set_geotech_band_class_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/set_geotech_band_class_request.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the schema and imports ``UUID``, ``Field``, and the strict base.

**Why it is here.** A request schema on the strict base.

.. CG-EXPLANATION-END id=module-header

Class ``SetGeotechBandClassRequest``
------------------------------------

.. CG-BLOCK id=class:SetGeotechBandClassRequest lines=12-30

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/set_geotech_band_class_request.py
   :language: python
   :lines: 12-30
   :lineno-match:

.. CG-EXPLANATION-START id=class:SetGeotechBandClassRequest

**What this does.** The body for setting a borehole band's NAD packing class by hand: the band id and the chosen class, constrained to the range 1 to 31 (``ge=1, le=31`` = greater-or-equal 1, less-or-equal 31).

**Why it is here.** The range guard rejects an impossible class at the wire; the docstring notes the server further validates the class against the band's own soil family (owner ask 2026-08-18). NAD packing classes follow NBN EN 1997-1 ANB Tabel 2.1.

.. CG-EXPLANATION-END id=class:SetGeotechBandClassRequest

