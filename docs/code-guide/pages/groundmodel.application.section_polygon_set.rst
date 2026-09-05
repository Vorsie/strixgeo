groundmodel.application.section_polygon_set
===========================================

.. CG-PAGE source=src/groundmodel/application/section_polygon_set.py complete=true

*Source file:* ``src/groundmodel/application/section_polygon_set.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-46

.. literalinclude:: ../../../src/groundmodel/application/section_polygon_set.py
   :language: python
   :lines: 1-46
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A pure data file: the docstring and the imports for frozen data holders and the id type. It declares the closed-geometry export shapes.

**Why it is here.** The docstring records why a second contract exists beside the section snapshot: the existing exporters (DXF, Plaxis 2-D, PDF) consume formation picks, but D-Stability has no borehole concept — its geometry is a set of closed soil-layer polygons — so it needs the partition fill the section editor already shows. The units here carry characterisation only (NAD class, soil, name), not design parameters, the same Phase 4 / Phase 5 split as the other snapshots.

.. CG-EXPLANATION-END id=module-header

Class ``SectionPolygonUnit``
----------------------------

.. CG-BLOCK id=class:SectionPolygonUnit lines=47-87

.. literalinclude:: ../../../src/groundmodel/application/section_polygon_set.py
   :language: python
   :lines: 47-87
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionPolygonUnit

**What this does.** A frozen data holder for one drawn unit's export identity: the source formation id, the name, the optional NAD class and soil code, the colour and the display order.

**Why it is here.** The formation id is the only globally unique handle, carried so a downstream script can tell apart two units that legitimately share a NAD class and a soil code. Same pass-through-identifier and holds-data-only pattern as the other snapshot units.

.. CG-EXPLANATION-END id=class:SectionPolygonUnit

Class ``SectionPolygon``
------------------------

.. CG-BLOCK id=class:SectionPolygon lines=88-118

.. literalinclude:: ../../../src/groundmodel/application/section_polygon_set.py
   :language: python
   :lines: 88-118
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionPolygon

**What this does.** A frozen data holder for one closed filled area: which unit fills it, its outline as absolute (along-metres, elevation) points, the gap index it came from, and an optional resolver-assigned body id.

**Why it is here.** The docstring records that the ring is not closed (the first point is not repeated) and its winding is whatever the two-dimensional engine produced — targets that care normalise it themselves. The gap index is kept for diagnostics because a warning that names the gap is the only way to find the offending region in the editor, and the body id lets a target that can group layers keep one correlated body as one entity.

.. CG-EXPLANATION-END id=class:SectionPolygon

Class ``SectionPolygonSet``
---------------------------

.. CG-BLOCK id=class:SectionPolygonSet lines=119-168

.. literalinclude:: ../../../src/groundmodel/application/section_polygon_set.py
   :language: python
   :lines: 119-168
   :lineno-match:

.. CG-EXPLANATION-START id=class:SectionPolygonSet

**What this does.** The top-level frozen data holder for one cross-section's closed geometry: project and section identity, section length, coordinate system, vertical-datum label, the column along-distances, the units, and the filled polygons.

**Why it is here.** This is what a closed-geometry exporter receives through its abstract export method, built by the resolver from a scope-guarded snapshot plus the renderer's partition, so the infrastructure layer stays pure. The column positions are carried so a one-dimensional-profile exporter such as D-Sheet Piling can state which columns bracket a sampled position, and units with no polygon are absent so no empty layer is ever emitted.

.. CG-EXPLANATION-END id=class:SectionPolygonSet

