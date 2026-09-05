groundmodel.infrastructure.db.migrations.versions.o9i0j1k2l3m4_mirror_litho_contact_writes
==========================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/o9i0j1k2l3m4_mirror_litho_contact_writes.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/o9i0j1k2l3m4_mirror_litho_contact_writes.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-158

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/o9i0j1k2l3m4_mirror_litho_contact_writes.py
   :language: python
   :lines: 1-158
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``o9i0j1k2l3m4``, following ``n8h9i0j1k2l3``) that installs a database *trigger* — code the database runs automatically after a row changes — mirroring litho-model contact writes into the layer table. The trigger function and its attachment SQL are defined here.

**Why it is here.** The docstring records the cut-over problem: the frontend now reads from the layer endpoint but writes still flow through the contact use cases, so without a bridge every write would produce a stale read. A trigger is chosen over a repository hook because the contact write surface is wide (eight-plus use cases), a trigger is one removable file, and it can reuse the same base-depth derivation the back-fill already encodes. The bridge is intentionally temporary and is dropped once all writers move to the layer endpoints.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=159-164

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/o9i0j1k2l3m4_mirror_litho_contact_writes.py
   :language: python
   :lines: 159-164
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Installs the trigger function — which, for a litho model with a real anchor, prunes orphan layers and upserts the current layers from the contact state — and attaches it to fire after every insert, update or delete on the contacts table.

**Why it is here.** The docstring explains the function re-derives layers with the same window-function rule as the back-fill, so no new logic is introduced; synthetic pinch-outs with no anchor are skipped.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=165-168

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/o9i0j1k2l3m4_mirror_litho_contact_writes.py
   :language: python
   :lines: 165-168
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the trigger and its function.

**Why it is here.** This is the retirement path the docstring describes for a later slice.

.. CG-EXPLANATION-END id=function:downgrade

