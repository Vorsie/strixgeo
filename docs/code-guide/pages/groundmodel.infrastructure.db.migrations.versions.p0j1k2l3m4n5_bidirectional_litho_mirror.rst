groundmodel.infrastructure.db.migrations.versions.p0j1k2l3m4n5_bidirectional_litho_mirror
=========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/p0j1k2l3m4n5_bidirectional_litho_mirror.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/p0j1k2l3m4n5_bidirectional_litho_mirror.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-226

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/p0j1k2l3m4n5_bidirectional_litho_mirror.py
   :language: python
   :lines: 1-226
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``p0j1k2l3m4n5``, following ``o9i0j1k2l3m4``) that adds the reverse trigger — mirroring layer writes back into contacts for accepted rows — and patches the existing forward trigger. The forward function, the new reverse function, and its attachment SQL are defined here.

**Why it is here.** The docstring records that the frontend writers are about to move to the layer endpoints, so the inverse direction must exist first for correlation foreign keys and the bundle export (which still reads contacts) to stay intact. The patch scopes the forward trigger's orphan-prune to accepted rows only, so flipping a layer from accepted to pending no longer deletes the layer the user wanted to keep. Runaway looping between the two triggers is bounded by a depth guard.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=227-233

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/p0j1k2l3m4n5_bidirectional_litho_mirror.py
   :language: python
   :lines: 227-233
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Installs the patched forward function, the new layer-to-contact function, and the reverse trigger that fires after every insert, update or delete on the layer table.

**Why it is here.** The docstring explains the reverse trigger upserts a contact for an accepted layer and deletes it when a layer becomes pending, rejected or deleted, while the depth guard stops the two triggers from firing each other endlessly.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=234-339

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/p0j1k2l3m4n5_bidirectional_litho_mirror.py
   :language: python
   :lines: 234-339
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the reverse trigger and function and restores the forward function to its earlier, unpatched shape.

**Why it is here.** The docstring notes the restored forward function matches what the previous slice installed, so the reverse returns the pair of triggers to their prior state.

.. CG-EXPLANATION-END id=function:downgrade

