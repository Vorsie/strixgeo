groundmodel.api.schemas.project.geotech_band_edit.split_geotech_band_request
============================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_band_edit/split_geotech_band_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_band_edit/split_geotech_band_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/split_geotech_band_request.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the schema and imports ``UUID``, ``Field``, and the strict base.

**Why it is here.** A request schema on the strict base.

.. CG-EXPLANATION-END id=module-header

Class ``SplitGeotechBandRequest``
---------------------------------

.. CG-BLOCK id=class:SplitGeotechBandRequest lines=12-30

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/split_geotech_band_request.py
   :language: python
   :lines: 12-30
   :lineno-match:

.. CG-EXPLANATION-START id=class:SplitGeotechBandRequest

**What this does.** The body of the split and split-preview endpoints: the band to split and the proposed boundary depth.

**Why it is here.** The docstring records that the depth must fall strictly inside the band's own litho body, and the server refuses anything else with a ``422`` — the engineer overrules the class, not the hierarchy.

.. CG-EXPLANATION-END id=class:SplitGeotechBandRequest

