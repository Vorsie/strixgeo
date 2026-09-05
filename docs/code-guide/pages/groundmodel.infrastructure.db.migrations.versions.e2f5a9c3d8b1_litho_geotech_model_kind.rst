groundmodel.infrastructure.db.migrations.versions.e2f5a9c3d8b1_litho_geotech_model_kind
=======================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/e2f5a9c3d8b1_litho_geotech_model_kind.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/e2f5a9c3d8b1_litho_geotech_model_kind.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e2f5a9c3d8b1_litho_geotech_model_kind.py
   :language: python
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds a ``kind`` discriminator and a self-referential parent link to ``geological_model``, and lithology and NAD-class columns to ``geological_formation``. The header carries its revision id and the id it follows.

**Why it is here.** The docstring ties this to the three-level modelling hierarchy: sibling model rows are told apart by ``kind``, and the parent link is a self-foreign-key with restrict-on-delete so a geological model cannot be deleted while a lithostratigraphic model refines it (the API surfaces that as a 409). The lithology and NAD-class columns carry the litho and geotech unit attributes on the shared formation table and are empty on a geological-model formation.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=30-59

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e2f5a9c3d8b1_litho_geotech_model_kind.py
   :language: python
   :lines: 30-59
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds ``kind`` (defaulting to geological) and the parent-model link to ``geological_model``, and ``lithology`` and ``nad_class`` to ``geological_formation``.

**Why it is here.** The docstring notes no data migration is needed: existing rows take kind geological and no parent via the default, which is the correct state for the pre-existing single-level models.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=60-65

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e2f5a9c3d8b1_litho_geotech_model_kind.py
   :language: python
   :lines: 60-65
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the four columns added by this revision in reverse order.

**Why it is here.** The exact reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

