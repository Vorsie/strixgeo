groundmodel.infrastructure.db.migrations.versions.q1k2l3m4n5o6_correlation_edge_fk_to_layer
===========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/q1k2l3m4n5o6_correlation_edge_fk_to_layer.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/q1k2l3m4n5o6_correlation_edge_fk_to_layer.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-53

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/q1k2l3m4n5o6_correlation_edge_fk_to_layer.py
   :language: python
   :lines: 1-53
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``q1k2l3m4n5o6``, following ``p0j1k2l3m4n5``) that moves the contact-correlation edge's two endpoint foreign keys from pointing at the contacts table to pointing at the layer table. The old and new constraint names are defined here.

**Why it is here.** The docstring records that the ids are identical between the two tables (the back-fill preserved them and the trigger pair keeps each accepted layer one-to-one with its contact mirror), so the target can move with no data movement. This decouples the correlation graph from the contact mirror so the later contact-deletion cleanup no longer cascades away the edges.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=54-75

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/q1k2l3m4n5o6_correlation_edge_fk_to_layer.py
   :language: python
   :lines: 54-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Drops the two contact-targeted foreign keys and adds two new layer-targeted ones that cascade on delete.

**Why it is here.** The docstring explains that pointing the edges at layers first makes the later contact drops free, and if a stale edge referenced a missing layer the add would fail loudly rather than silently deleting the bad row.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=76-95

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/q1k2l3m4n5o6_correlation_edge_fk_to_layer.py
   :language: python
   :lines: 76-95
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the layer-targeted foreign keys and restores the contact-targeted ones.

**Why it is here.** This reverses the retargeting.

.. CG-EXPLANATION-END id=function:downgrade

