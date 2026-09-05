groundmodel.infrastructure.db.migrations.versions.d5e6f7a8b9c0_add_geotech_tie_tombstone
========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/d5e6f7a8b9c0_add_geotech_tie_tombstone.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/d5e6f7a8b9c0_add_geotech_tie_tombstone.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d5e6f7a8b9c0_add_geotech_tie_tombstone.py
   :language: python
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds one table, ``geotech_tie_tombstone``, recording a packing tie the engineer deleted so it stays deleted. The header carries its revision id and the id it follows.

**Why it is here.** The docstring records the owner rulings: a deleted tie must stay deleted on the geotech model but not touch the litho model, keyed by its place — left position, right position and the section. The packing bands are rebuilt with new ids on every rebuild, so a tombstone naming band ids would stop matching and the deleted tie would return; storing the place (map x/y and contact elevation) survives the rebuild.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=28-60

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d5e6f7a8b9c0_add_geotech_tie_tombstone.py
   :language: python
   :lines: 28-60
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Creates ``geotech_tie_tombstone`` with an id, the model and section it belongs to, the two endpoint places as x/y/z, and a creation timestamp; the model and section links cascade-delete.

**Why it is here.** Storing the endpoints as coordinates, not band ids, is the whole point — coordinates survive the band rebuild that new ids would not, as the docstring explains.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=61-63

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/d5e6f7a8b9c0_add_geotech_tie_tombstone.py
   :language: python
   :lines: 61-63
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the ``geotech_tie_tombstone`` table.

**Why it is here.** The exact reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

