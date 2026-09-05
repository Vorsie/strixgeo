groundmodel.infrastructure.exporters.section_geometry_exporter
==============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/section_geometry_exporter.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/section_geometry_exporter.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/section_geometry_exporter.py
   :language: python
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's description and its imports: the abstract-base-class tools, the closed-geometry input type (``SectionPolygonSet`` — the section's drawn fill turned into closed rings of points, a *ring* being a loop of corner points that encloses an area), and the logging base class.

**Why it is here.** The third sibling of the ``BaseExporter`` split (docs/exports.md, debt #109). The Deltares D-Series targets live here because D-Stability's geometry IS a set of closed soil-layer polygons, and D-Sheet Piling reads a 1-D column through the same polygons. This base class exists because those two need the drawn fill itself, not the picks behind it.

.. CG-EXPLANATION-END id=module-header

Class ``SectionGeometryExporter`` — header
------------------------------------------

.. CG-BLOCK id=class:SectionGeometryExporter lines=21-27

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/section_geometry_exporter.py
   :language: python
   :lines: 21-27
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionGeometryExporter

**What this does.** Declares the abstract base class for exporters that consume closed 2-D geometry, inheriting the logging mixin and ``ABC``.

**Why it is here.** Naming the ``SectionPolygonSet`` input in its own base class is what keeps the D-Series family honest: the fill is POSTed from the renderer (what the engineer sees filled IS the model), never re-derived on the backend where it could quietly disagree with the screen (docs/exports.md, ``The closed-geometry contract``).

.. CG-EXPLANATION-END id=class:SectionGeometryExporter

Method ``SectionGeometryExporter``. ``def export``
--------------------------------------------------

.. CG-BLOCK id=method:SectionGeometryExporter.export lines=28-43

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/section_geometry_exporter.py
   :language: python
   :lines: 28-43
   :lineno-match:

.. CG-EXPLANATION-START id=method:SectionGeometryExporter.export

**What this does.** The method each subclass must write. It takes a ``SectionPolygonSet`` (the section's filled geometry) and returns the finished file as raw bytes.

**Why it is here.** The same bytes-out contract as the other two base classes, so the API layer packages every export the same way (docs/exports.md).

.. CG-EXPLANATION-END id=method:SectionGeometryExporter.export

