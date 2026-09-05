groundmodel.infrastructure.db.migrations.versions.y9z0a1b2c3d4_rename_edge_contact_columns_to_layer
===================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/y9z0a1b2c3d4_rename_edge_contact_columns_to_layer.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/y9z0a1b2c3d4_rename_edge_contact_columns_to_layer.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/y9z0a1b2c3d4_rename_edge_contact_columns_to_layer.py
   :language: python
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``y9z0a1b2c3d4``, following ``x8y9z0a1b2c3``) that renames the contact-correlation edge's four endpoint columns from contact vocabulary to layer vocabulary.

**Why it is here.** The docstring records audit ARCH-08: since the earlier foreign-key migration the endpoints hold layer ids, and only a code comment guarded against treating them as contacts; renaming makes the type part of the name. The two side columns ride along for coherence. A plain rename preserves the data and every constraint, and old saved projects still restore through read-side aliases.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=44-49

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/y9z0a1b2c3d4_rename_edge_contact_columns_to_layer.py
   :language: python
   :lines: 44-49
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Renames the four columns — the two endpoint ids and the two side columns — to their layer names in a loop.

**Why it is here.** The rename makes the layer type visible in the column names.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=50-53

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/y9z0a1b2c3d4_rename_edge_contact_columns_to_layer.py
   :language: python
   :lines: 50-53
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Restores the retired contact-vocabulary column names.

**Why it is here.** This reverses the renames.

.. CG-EXPLANATION-END id=function:downgrade

