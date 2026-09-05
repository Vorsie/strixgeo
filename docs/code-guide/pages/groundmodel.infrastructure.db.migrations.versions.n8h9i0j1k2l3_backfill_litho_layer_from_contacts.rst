groundmodel.infrastructure.db.migrations.versions.n8h9i0j1k2l3_backfill_litho_layer_from_contacts
=================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/n8h9i0j1k2l3_backfill_litho_layer_from_contacts.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/n8h9i0j1k2l3_backfill_litho_layer_from_contacts.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-146

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/n8h9i0j1k2l3_backfill_litho_layer_from_contacts.py
   :language: python
   :lines: 1-146
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the migration (revision ``n8h9i0j1k2l3``, following ``m7g8h9i0j1k2``) that back-fills ``litho_layer`` rows from existing contact rows on litho models — a *backfill* being a data-moving step that populates a new table from old data. The two big SQL strings that do the copy and its reverse are defined here.

**Why it is here.** The docstring records that all existing litho data lives in the contacts table, and the move keeps the original ids so correlation edges, seeded-contact id arrays, and litho-to-geo couples all keep resolving without a rewrite. A contact stores only its top depth, so each layer's base is derived from the next contact down (or the anchor's total depth, or a small sentinel) to satisfy the depth-ordering rule; synthetic pinch-out contacts with no anchor are skipped, and the copy is safe to re-run.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=147-151

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/n8h9i0j1k2l3_backfill_litho_layer_from_contacts.py
   :language: python
   :lines: 147-151
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Runs the copy SQL that inserts a layer for every litho-model contact, deriving each base depth and mapping the source token, skipping duplicates by id.

**Why it is here.** The docstring explains this is the only direction that ships data; it preserves ids and derives bases so downstream references survive.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=152-154

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/n8h9i0j1k2l3_backfill_litho_layer_from_contacts.py
   :language: python
   :lines: 152-154
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Runs the reverse SQL that deletes the layer rows whose ids match a litho-model contact.

**Why it is here.** This removes only the rows the copy could have created, leaving any natively-created layers untouched.

.. CG-EXPLANATION-END id=function:downgrade

