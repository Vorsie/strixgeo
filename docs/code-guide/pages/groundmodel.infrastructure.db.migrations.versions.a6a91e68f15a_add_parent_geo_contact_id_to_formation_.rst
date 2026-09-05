groundmodel.infrastructure.db.migrations.versions.a6a91e68f15a_add_parent_geo_contact_id_to_formation_
======================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/a6a91e68f15a_add_parent_geo_contact_id_to_formation_.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/a6a91e68f15a_add_parent_geo_contact_id_to_formation_.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a6a91e68f15a_add_parent_geo_contact_id_to_formation_.py
   :language: python
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds a ``parent_geo_contact_id`` foreign-key column (and index) to the formation-contact table. The header carries only the revision chain.

**Why it is here.** Why: not recorded — ask the owner. (The column links a litho contact to the geological contact it was coupled to; a later data-repair migration back-links litho layers sitting exactly on an unlinked geological contact, which is the mechanism this column supports.)

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=20-40

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a6a91e68f15a_add_parent_geo_contact_id_to_formation_.py
   :language: python
   :lines: 20-40
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds the ``parent_geo_contact_id`` column, its self-referencing foreign key, and an index.

**Why it is here.** The link records which geological contact a litho contact is coupled to; the index speeds lookups by that parent.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=41-45

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/a6a91e68f15a_add_parent_geo_contact_id_to_formation_.py
   :language: python
   :lines: 41-45
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the index, the foreign key, and the column.

**Why it is here.** So the chain can step backwards; the reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

