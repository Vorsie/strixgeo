groundmodel.infrastructure.db.models.cpt_orm
============================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/cpt_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/cpt_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/cpt_orm.py
   :language: python
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``Geometry`` / ``WKBElement`` (PostGIS), the column types, ``func``, the Postgres ``UUID`` type, ``Mapped`` / ``mapped_column`` / ``relationship``, the ``ElevationSource`` enum, ``Base``, and the loader-strategy constant.

**Why it is here.** The same toolbox as the borehole table — a CPT is stored with the same coordinate-plus-PostGIS pattern and the same elevation-provenance column.

.. CG-EXPLANATION-END id=module-header

Class ``CptOrm``
----------------

.. CG-BLOCK id=class:CptOrm lines=18-121

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/cpt_orm.py
   :language: python
   :lines: 18-121
   :lineno-match:

.. CG-EXPLANATION-START id=class:CptOrm

**What this does.** Defines the ``cpt`` table: header metadata and cone properties for one cone-penetration test. It carries the raw coordinates with EPSG codes, a PostGIS ``location`` point, the elevation and water-table depth each with a provenance column and a rollback snapshot, the cone properties (net area ratio, cone type, stop criterion), a denormalised ``max_depth_m`` / ``n_rows`` summary, timestamps, and a one-to-one ``relationship`` to its raw series.

**Why it is here.** The heavy depth-series arrays live in a separate ``cpt_series`` table so that list and map queries can read the summary without dragging in ten thousand floats per CPT (the depth-series storage decision in CLAUDE.md). The ``cone_area_ratio`` is never inferred — the comment stresses that using a wrong a-value corrupts the corrected-resistance calculation, so its absence is flagged, not guessed. The series link uses ``uselist=False`` because each CPT has exactly one series row.

.. CG-EXPLANATION-END id=class:CptOrm

