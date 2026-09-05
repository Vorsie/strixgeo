groundmodel.infrastructure.db.migrations.versions.e1c2d3a4b5f6_enforce_litho_layer_contiguity
=============================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/e1c2d3a4b5f6_enforce_litho_layer_contiguity.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/e1c2d3a4b5f6_enforce_litho_layer_contiguity.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-114

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e1c2d3a4b5f6_enforce_litho_layer_contiguity.py
   :language: python
   :lines: 1-114
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that guarantees a litho column can have no gaps, by sweeping existing data closed and installing a database trigger that checks contiguity at commit. A trigger is code the database runs automatically on a change. The header carries its revision id, the id it follows, and three SQL constants: the sweep, the check function, and the trigger.

**Why it is here.** The docstring records the owner's remark that no gaps were meant to be possible. The mirror triggers re-derive each layer's base from the next contact, but only on contact changes, so a base stranded by legacy data or another write path could leave a gap the partition fill then shows as a hole (a real 1.07 m hole in a dogfeed). This moves the guarantee into the data layer so any transaction that would commit a gap fails loudly instead of corrupting the column silently.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=115-121

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e1c2d3a4b5f6_enforce_litho_layer_contiguity.py
   :language: python
   :lines: 115-121
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Runs the one-time sweep that snaps every non-last accepted layer's base to the next layer's top, then creates the check function and the deferred constraint trigger that re-checks contiguity at commit.

**Why it is here.** The sweep closes any pre-existing gap or overlap; the trigger is a backstop that turns a silent data bug into an immediate named error. Normal flows already re-derive contiguity before commit, so the check rarely fires.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=122-125

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/e1c2d3a4b5f6_enforce_litho_layer_contiguity.py
   :language: python
   :lines: 122-125
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Drops the trigger and its function; the swept data stays closed.

**Why it is here.** The swept values remain valid without the guard, so only the trigger and function are removed.

.. CG-EXPLANATION-END id=function:downgrade

