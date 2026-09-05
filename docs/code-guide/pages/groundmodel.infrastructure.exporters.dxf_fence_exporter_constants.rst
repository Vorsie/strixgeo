groundmodel.infrastructure.exporters.dxf_fence_exporter_constants
=================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/dxf_fence_exporter_constants.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/dxf_fence_exporter_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_fence_exporter_constants.py
   :language: python
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The fixed values for the fence DXF exporter: the ``Fence-`` layer-name prefix, the 255-character cap AutoCAD puts on a layer name, the set of characters DXF forbids in a layer name, and a mid-grey fallback colour.

**Why it is here.** Grouped here because the project convention is that module-level constants never sit at the top of a class file. The ``Fence-`` prefix mirrors the section exporter's ``GeoModel-`` prefix so the two read consistently in CAD's layer browser. The grey fallback means a panel whose colour string fails to parse still lands in CAD (just in grey) instead of blocking the export of otherwise-valid geometry.

.. CG-EXPLANATION-END id=module-header

