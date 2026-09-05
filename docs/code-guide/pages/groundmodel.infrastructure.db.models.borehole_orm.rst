groundmodel.infrastructure.db.models.borehole_orm
=================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/borehole_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/borehole_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/borehole_orm.py
   :language: python
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: ``Geometry`` and ``WKBElement`` from GeoAlchemy2 (the PostGIS bridge), the column types (``Date``, ``DateTime``, ``Double``, ``Index``, ``Integer``, ``String``), ``func``, the Postgres ``UUID`` type, ``Mapped`` / ``mapped_column`` / ``relationship``, the ``ElevationSource`` enum, ``Base``, and the loader-strategy constant.

**Why it is here.** ``Geometry`` is a *PostGIS* column type — PostGIS is the geographic extension to Postgres — and ``WKBElement`` is how a point comes back in Python. The table needs it for spatial (map / distance) queries. The ``ElevationSource`` enum is imported so the surface-elevation provenance can be stored as a column.

.. CG-EXPLANATION-END id=module-header

Class ``BoreholeOrm``
---------------------

.. CG-BLOCK id=class:BoreholeOrm lines=18-138

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/borehole_orm.py
   :language: python
   :lines: 18-138
   :lineno-match:

.. CG-EXPLANATION-START id=class:BoreholeOrm

**What this does.** Defines the ``borehole`` table: the stored form of a physical hole. It keeps the raw source coordinates as plain numbers with their own EPSG codes, a PostGIS ``location`` point for spatial queries, the elevation and its provenance (plus a rollback snapshot), the source-vocabulary metadata fields, denormalised child counts, timestamps, and four ``relationship`` links to its child tables (drill segments, field-log intervals, observations, samples). Two ``Index`` entries cover the spatial lookup (a GIST index, the kind PostGIS uses) and the project scope.

**Why it is here.** A borehole is *not a test* — the docstring restates the domain rule, and its children live in their own tables linked by foreign key. The ``location`` point is nullable because incomplete sources sometimes omit coordinate-system metadata; the row is still stored and the parser flags the gap. Each child relationship uses ``cascade="all, delete-orphan"`` (deleting the borehole deletes its children) and ``order_by`` (children come back depth-ordered). The child counts are denormalised for cheap list queries and are written in the same transaction as the parent, never treated as authoritative (Data-Integrity rule 4).

.. CG-EXPLANATION-END id=class:BoreholeOrm

