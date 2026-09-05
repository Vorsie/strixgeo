groundmodel.infrastructure.db.migrations.versions.a3b7e29f4d10_add_formation_surface
====================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/a3b7e29f4d10_add_formation_surface.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/a3b7e29f4d10_add_formation_surface.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-47

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a3b7e29f4d10_add_formation_surface.py
   :language: python
   :lines: 1-47
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that creates a formation-surface table — a derived cache holding one interpolated geological surface per model-and-formation pair.

**Why it is here.** The docstring records that the source of truth stays the formation contacts; this table caches the triangulated surface so the section editor and exporters can answer "give me a polyline along this line" without re-triangulating on every render. The method is a short string (not a fixed enum) so a future switch of interpolation method needs no schema change; the geometry is stored as flexible JSON; there is exactly one cached surface per pair; and it is a pure cache that repopulates from the bundle or the next contact edit.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=48-93

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a3b7e29f4d10_add_formation_surface.py
   :language: python
   :lines: 48-93
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates the formation-surface cache table with its per-model index.

**Why it is here.** Adds the cache the render and export paths read; the index speeds finding a model's surfaces.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=94-97

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a3b7e29f4d10_add_formation_surface.py
   :language: python
   :lines: 94-97
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the index and the cache table.

**Why it is here.** So the chain can step backwards; safe because it is only a cache.

.. CG-EXPLANATION-END id=function:downgrade

