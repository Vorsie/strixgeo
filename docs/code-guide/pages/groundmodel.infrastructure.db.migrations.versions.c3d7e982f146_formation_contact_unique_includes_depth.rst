groundmodel.infrastructure.db.migrations.versions.c3d7e982f146_formation_contact_unique_includes_depth
======================================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/c3d7e982f146_formation_contact_unique_includes_depth.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/c3d7e982f146_formation_contact_unique_includes_depth.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-45

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c3d7e982f146_formation_contact_unique_includes_depth.py
   :language: python
   :lines: 1-45
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that replaces two uniqueness rules on ``formation_contact`` with wider versions that also include the depth of the contact. The header carries its revision id and the id it follows.

**Why it is here.** The docstring records a real dogfeed bug. The earlier rule of one contact per (model, formation, anchor) fits the geological model — one Boom Clay top per borehole — but breaks the lithostratigraphic model, where several sand layers at different depths on one CPT all map to a single ZAND formation row. Accepting a second same-lithology suggestion then hit the rule and showed a red could-not-accept toast. Adding depth to the key allows those distinct-depth contacts while still catching exact duplicates.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=46-71

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c3d7e982f146_formation_contact_unique_includes_depth.py
   :language: python
   :lines: 46-71
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Drops the two older partial unique indexes if present, then creates two new partial unique indexes on (model, formation, anchor, depth) — one for borehole-anchored contacts, one for CPT-anchored. A partial unique index enforces uniqueness only over the rows its condition selects, here the rows where that anchor column is filled.

**Why it is here.** The drop uses if-exists because an older or freshly built database sometimes has only one of the two indexes. Including depth matches the application's idempotent re-accept lookup exactly, so a re-accept updates the same row instead of colliding.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=72-101

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/c3d7e982f146_formation_contact_unique_includes_depth.py
   :language: python
   :lines: 72-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Reverses it: drops the depth-including indexes and restores the (model, formation, anchor)-only versions.

**Why it is here.** The docstring notes this needs no duplicate-depth rows to exist first, which is acceptable pre-ship but would need a dedupe pass in production.

.. CG-EXPLANATION-END id=function:downgrade

