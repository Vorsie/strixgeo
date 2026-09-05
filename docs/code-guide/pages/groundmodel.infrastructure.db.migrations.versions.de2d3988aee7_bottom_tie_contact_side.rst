groundmodel.infrastructure.db.migrations.versions.de2d3988aee7_bottom_tie_contact_side
======================================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/migrations/versions/de2d3988aee7_bottom_tie_contact_side.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/migrations/versions/de2d3988aee7_bottom_tie_contact_side.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/de2d3988aee7_bottom_tie_contact_side.py
   :language: python
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A migration that adds a per-endpoint side marker (top or base) to the litho correlation-edge table so an edge can address a layer's base, and widens the edge's uniqueness rule to match. The header carries its revision id and the id it follows.

**Why it is here.** The docstring explains a bottom-tie is an edge whose both endpoints are on the base, which lets the deepest layer — which has no layer below it and so no top-keyed base contact — be correlated at its base so it can band. Both columns default to top, so every existing edge is unchanged, and the design is set out in the bottom-tie correlation spec.

.. CG-EXPLANATION-END id=module-header

Function ``def upgrade``
------------------------

.. CG-BLOCK id=function:upgrade lines=31-76

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/de2d3988aee7_bottom_tie_contact_side.py
   :language: python
   :lines: 31-76
   :lineno-match:

.. CG-EXPLANATION-START id=function:upgrade

**What this does.** Adds ``contact_a_side`` and ``contact_b_side`` defaulting to top, adds a check constraint pinning them to top or base, then drops and re-creates the edge's uniqueness rule to include the two side columns.

**Why it is here.** Widening the uniqueness key lets a top-to-top edge and a base-to-base bottom-tie between the same two layers on the same section coexist, which the docstring identifies as the goal.

.. CG-EXPLANATION-END id=function:upgrade

Function ``def downgrade``
--------------------------

.. CG-BLOCK id=function:downgrade lines=77-95

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/migrations/versions/de2d3988aee7_bottom_tie_contact_side.py
   :language: python
   :lines: 77-95
   :lineno-match:

.. CG-EXPLANATION-START id=function:downgrade

**What this does.** Reverses it in opposite order: restores the narrower uniqueness rule, drops the check, then drops the two side columns.

**Why it is here.** The exact reverse of the upgrade.

.. CG-EXPLANATION-END id=function:downgrade

