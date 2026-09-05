groundmodel.infrastructure.exporters.dstability_exporter_constants
==================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/dstability_exporter_constants.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/dstability_exporter_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-64

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dstability_exporter_constants.py
   :language: python
   :lines: 1-64
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The fixed values for the D-Stability (``.stix``) exporter, in two groups. The geometry tolerances decide whether a drawn region is a real polygon worth handing to GEOLib at all: a smallest area (below it the ring is really a line) and a smallest vertex count (three, the least that can enclose an area). The fixed strings are what an engineer reads inside the file: the ``Remarks`` disclaimer, the ``StrixGeo`` producer stamp, the per-layer note template, and the ``n/a`` absent marker.

**Why it is here.** The smallest-area floor is matched to the 2-D drawing engine's own zero-area floor so a region the editor treats as real is never dropped here. The ``Remarks`` line is the liability statement written INSIDE the artefact — because the file outlives the conversation that produced it — and it states plainly that the geometry and soil identification come from the drawn section but the design PARAMETERS are NOT exported: every strength, stiffness and unit-weight field is left at the D-Stability default for the engineer to fill (docs/exports.md; the D-Series exporters write NO design parameter). A ``.stix`` is D-Stability's project file, a zip archive. When a unit's class is missing from the NAD table (the shipped state) the soil is written with name and code only, and GEOLib's own zeros are then the honest, unmistakable blank; the exporter deliberately does not touch GEOLib's ``Su``-below-water default on that path, because the zeros already say ``blank`` and changing it would alter dogfed behaviour.

.. CG-EXPLANATION-END id=module-header

