groundmodel.infrastructure.db.migrations.versions.b3c4d5e6f7a8_relink_coinciding_geo_contacts
=============================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/b3c4d5e6f7a8_relink_coinciding_geo_contacts.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/b3c4d5e6f7a8_relink_coinciding_geo_contacts.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b3c4d5e6f7a8_relink_coinciding_geo_contacts.py
   :language: python
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-time data-repair migration that back-links litho layers sitting exactly on an unlinked geological contact.

**Why it is here.** The docstring records the audit finding (owner ruling 2026-08-11): accept-time coupling snaps the geological contact's depth onto the litho boundary and links them, but deleting and re-accepting a litho contact used to restore the row without the link, leaving one physical boundary recorded twice with no coupling — so a later move carried the litho row and left the geological contact behind. The code paths are fixed in the same batch; this repairs the rows that already exist, linking only unambiguous pairs within a sub-millimetre coincidence tolerance where an accidental coincidence cannot exist.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=32-62

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b3c4d5e6f7a8_relink_coinciding_geo_contacts.py
   :language: python
   :lines: 32-62
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Runs one SQL statement that links every accepted litho layer to its single coinciding, unlinked geological contact on the same investigation within the coincidence tolerance.

**Why it is here.** Restores the coupling the earlier re-accept bug dropped, without touching genuinely separate boundaries.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=63-64

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/b3c4d5e6f7a8_relink_coinciding_geo_contacts.py
   :language: python
   :lines: 63-64
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** A no-op — it does nothing.

**Why it is here.** The docstring explains that severing the repaired links would recreate the very defect being repaired.

.. CG-EXPLANATION-END id=function:downgrade

