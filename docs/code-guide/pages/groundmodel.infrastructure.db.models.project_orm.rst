groundmodel.infrastructure.db.models.project_orm
================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/models/project_orm.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/models/project_orm.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/project_orm.py
   :language: python
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description line and the toolbox: the column types (``ARRAY``, ``BigInteger``, ``DateTime``, ``Index``, ``Integer``, ``String``, ``Text``), ``func``, the Postgres ``JSONB`` and ``UUID`` types, ``Mapped`` / ``mapped_column`` and ``Base``.

**Why it is here.** The building blocks for the top-level project container table.

.. CG-EXPLANATION-END id=module-header

Class ``ProjectOrm``
--------------------

.. CG-BLOCK id=class:ProjectOrm lines=17-121

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/models/project_orm.py
   :language: python
   :lines: 17-121
   :lineno-match:

.. CG-EXPLANATION-START id=class:ProjectOrm

**What this does.** Defines the ``project`` table — the app-level container that scopes every CPT and borehole. It carries the name and rich metadata (number, client, site, tags, default CRS codes, phase, status), a soft-delete ``archived_at``, a JSONB ``view_state`` bag, the two staged/saved stratigraphy-lumping snapshots plus a monotonic revision counter, and timestamps.

**Why it is here.** Every CPT and borehole already carried an ``app_project_id``; promoting the project to a real table gives a source of truth for listing, renaming and archiving, and makes Save-As a duplicate-with-children rather than a file copy. ``archived_at`` is a *soft delete* — setting it hides the project from default listings but never destroys the row, matching the 'remove from view, never delete' UX rule. The staged/saved lumping columns mirror the desktop's two-stage save so a crash before File → Save no longer loses the lumping map, and the revision counter (not a wall-clock) is what crash-recovery compares, because timestamps move for unrelated reasons and a clock shift would invert the comparison (docs/design/autosave-recovery.md).

.. CG-EXPLANATION-END id=class:ProjectOrm

