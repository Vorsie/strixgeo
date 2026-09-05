groundmodel.infrastructure.db.migrations.versions.7deb298fb5c1_relax_litho_body_solid_body_id_fk_for_
=====================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/7deb298fb5c1_relax_litho_body_solid_body_id_fk_for_.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/7deb298fb5c1_relax_litho_body_solid_body_id_fk_for_.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/7deb298fb5c1_relax_litho_body_solid_body_id_fk_for_.py
   :language: python
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the migration that drops the foreign key from ``litho_body_solid.body_id`` to ``body.id``. Names its revision id and the migration it follows.

**Why it is here.** The docstring records the geology-bounding feature stores split body-halves under synthesised ids that are NOT rows in the ``body`` table (a build-only 3-D cache, with the real body model untouched), so a foreign key demanding every solid point at a real body row is incompatible and must be dropped.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=18-29

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/7deb298fb5c1_relax_litho_body_solid_body_id_fk_for_.py
   :language: python
   :lines: 18-29
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Drops the ``litho_body_solid_body_id_fkey`` foreign key.

**Why it is here.** The comment records this is exactly what lets the 3-D cache store geology-split half-bodies whose ids are not real ``body`` rows.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=30-41

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/7deb298fb5c1_relax_litho_body_solid_body_id_fk_for_.py
   :language: python
   :lines: 30-41
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Re-creates the foreign key from ``litho_body_solid.body_id`` to ``body.id`` with delete-cascade.

**Why it is here.** Restores the pre-geology-bounding behaviour where every cached solid corresponded to a real body row.

.. CG-EXPLANATION-END id=function:downgrade

