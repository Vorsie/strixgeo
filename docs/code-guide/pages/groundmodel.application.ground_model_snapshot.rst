groundmodel.application.ground_model_snapshot
=============================================

.. CG-PAGE source=src/groundmodel/application/ground_model_snapshot.py complete=true

*Source file:* ``src/groundmodel/application/ground_model_snapshot.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../src/groundmodel/application/ground_model_snapshot.py
   :language: python
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A pure data file: the docstring plus the imports for building frozen data holders and for the id type. It defines no behaviour, only the shapes the builder fills in.

**Why it is here.** The docstring records that ``GroundModelSnapshot`` is the typed value the project exporters (DXF, Plaxis, D-Sheet, GeoStudio) consume — the application layer assembles it from the database so the exporter never touches the ORM (the object-relational mapper that lets database rows appear as Python objects). It also records that per-layer design parameters are deliberately absent in Phase 4: the MVP gate is geometry-only, and Phase 5 adds parameters without callers paying a cost today.

.. CG-EXPLANATION-END id=module-header

Class ``LayerGeometry``
-----------------------

.. CG-BLOCK id=class:LayerGeometry lines=32-71

.. literalinclude:: ../../../src/groundmodel/application/ground_model_snapshot.py
   :language: python
   :lines: 32-71
   :lineno-match:

.. CG-EXPLANATION-START id=class:LayerGeometry

**What this does.** A frozen data holder for one layer — a formation from its top depth to its base depth — at one investigation column: the formation name and optional code, the top and base depths below surface, the easting and northing, and the surface elevation (which may be missing).

**Why it is here.** This is the row the exporters draw: one entry per (column, formation). The docstring pins the contract that base depth is strictly greater than top depth for any real layer, and that equal-depth degenerate rows are skipped during assembly. It holds data only, so it does not inherit the logger.

.. CG-EXPLANATION-END id=class:LayerGeometry

Class ``FormationDisplay``
--------------------------

.. CG-BLOCK id=class:FormationDisplay lines=72-131

.. literalinclude:: ../../../src/groundmodel/application/ground_model_snapshot.py
   :language: python
   :lines: 72-131
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormationDisplay

**What this does.** A frozen data holder for one formation's display metadata: name, optional code, stratigraphic display order, colour, the Belgian NAD packing class and main soil code (both optional), and the source formation id.

**Why it is here.** Carried alongside the layers so exporters need no second database lookup for a formation's order or colour, and only formations that actually appear in a layer are included so exporters never emit an empty material. The NAD class and soil code are the machine-usable identity a downstream tool maps to a material (debt #104) — they are null on a plain geological formation. All three optional fields default to null so older fixtures that build this positionally stay valid, per the additive-only API rule.

.. CG-EXPLANATION-END id=class:FormationDisplay

Class ``GroundModelSnapshot``
-----------------------------

.. CG-BLOCK id=class:GroundModelSnapshot lines=132-169

.. literalinclude:: ../../../src/groundmodel/application/ground_model_snapshot.py
   :language: python
   :lines: 132-169
   :lineno-match:

.. CG-EXPLANATION-START id=class:GroundModelSnapshot

**What this does.** The top-level frozen data holder: the project id and name, the coordinate-system code, and the lists of layers and formations. Every layer coordinate is expressed in that one coordinate system.

**Why it is here.** This is the object every project exporter receives through its abstract export method, assembled in one place so each exporter sees a consistent shape. Layer order is not significant here — exporters that need a particular order sort it themselves — and the formations list carries the stratigraphic order that globally-ordered exporters such as Plaxis 3-D need. Why: recorded in the docstring.

.. CG-EXPLANATION-END id=class:GroundModelSnapshot

