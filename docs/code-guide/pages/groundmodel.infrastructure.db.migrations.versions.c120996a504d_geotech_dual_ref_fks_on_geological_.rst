groundmodel.infrastructure.db.migrations.versions.c120996a504d_geotech_dual_ref_fks_on_geological_
==================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/c120996a504d_geotech_dual_ref_fks_on_geological_.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/c120996a504d_geotech_dual_ref_fks_on_geological_.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c120996a504d_geotech_dual_ref_fks_on_geological_.py
   :language: python
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds two self-referential foreign-key columns to ``geological_formation``: ``source_litho_formation_id`` and ``source_geo_formation_id``. The header names its revision id and the one it follows.

**Why it is here.** The docstring makes the (geological formation, lithology, NAD packing class) identity of a geotechnical unit a stored fact: one column names the lithostratigraphic formation the geotech unit subdivides, the other the geological formation it sits within. Both are stored because a Paleogene clay and a Quaternary clay carry different parameters, so the geological parent is kept explicitly, not only implied. Both are empty on geological- and litho-model rows.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=34-64

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c120996a504d_geotech_dual_ref_fks_on_geological_.py
   :language: python
   :lines: 34-64
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds ``source_litho_formation_id`` with a foreign key back to the same table, then ``source_geo_formation_id`` with its own foreign key, both set to clear the column when the parent is deleted.

**Why it is here.** Clear-on-delete means removing a parent formation demotes the geotech unit to unlinked rather than cascading and deleting it — the docstring's stated intent.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=65-70

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c120996a504d_geotech_dual_ref_fks_on_geological_.py
   :language: python
   :lines: 65-70
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the two foreign keys and their columns in reverse order.

**Why it is here.** The exact reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

