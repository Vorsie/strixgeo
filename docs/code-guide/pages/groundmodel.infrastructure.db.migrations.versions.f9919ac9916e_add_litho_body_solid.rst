groundmodel.infrastructure.db.migrations.versions.f9919ac9916e_add_litho_body_solid
===================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/f9919ac9916e_add_litho_body_solid.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/f9919ac9916e_add_litho_body_solid.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-51

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f9919ac9916e_add_litho_body_solid.py
   :language: python
   :lines: 1-51
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``f9919ac9916e``, following ``e3d34f7720e4``) that creates ``litho_body_solid`` — a cache table storing one triangulated watertight solid per model-and-body pair.

**Why it is here.** The docstring records that the source of truth stays the layer and contact rows; this table only caches the triangulated solid so the 3-D viewer and the DXF and Plaxis exporters can serve geometry without re-running the triangulation each request. Being a pure cache, it repopulates from a saved-project round-trip on a wiped database, and a stored checksum lets a recompute short-circuit when nothing changed.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=52-111

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f9919ac9916e_add_litho_body_solid.py
   :language: python
   :lines: 52-111
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates the table with its id, model, body and formation links, a method string, JSONB vertex and triangle payloads, a source count and checksum, stale and flagged booleans, timestamps, cascading foreign keys, and a unique constraint of one solid per model-and-body; adds an index by model.

**Why it is here.** The comments explain the method is a short string rather than a database enum so a future triangulation method needs no type change, the geometry is JSONB so it can grow without altering the table, and the flagged boolean marks a best-effort (not fully watertight) solid with an amber badge that does not block save or export.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=112-115

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/f9919ac9916e_add_litho_body_solid.py
   :language: python
   :lines: 112-115
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the model index and then the ``litho_body_solid`` table.

**Why it is here.** The reverse in dependency order.

.. CG-EXPLANATION-END id=function:downgrade

