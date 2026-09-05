groundmodel.application.create_perpendicular_companion
======================================================

.. CG-PAGE source=src/groundmodel/application/create_perpendicular_companion.py complete=true

*Source file:* ``src/groundmodel/application/create_perpendicular_companion.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-77

.. literalinclude:: ../../../src/groundmodel/application/create_perpendicular_companion.py
   :language: python
   :lines: 1-77
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the perpendicular-companion file: a docstring, the imports (the scope guard, the body/section/contact/investigation rows and the cross-section repository), and two tuning constants — the 250 m corridor within which an investigation counts as reachable from the companion line, and the 100 m minimum half-length used when no investigation is found on a side. The docstring lays out the nine-step algorithm.

**Why it is here.** A *lens* is a body that pinches out sideways, so a single cross-section only pins it in one direction; this use case builds a second section running perpendicular to the primary one and centred on the lens (the Q3 directive in debt #101). The docstring records the design decisions: the single-companion rule is enforced in this layer (not by a database constraint) because 'at most one AUTO-companion' is a business rule, not a structural one; and the primary section is chosen by an explicit stored reference because deriving it from contact membership breaks in three named cases.

.. CG-EXPLANATION-END id=module-header

Class ``CreatePerpendicularCompanionResult``
--------------------------------------------

.. CG-BLOCK id=class:CreatePerpendicularCompanionResult lines=78-94

.. literalinclude:: ../../../src/groundmodel/application/create_perpendicular_companion.py
   :language: python
   :lines: 78-94
   :lineno-match:

.. CG-EXPLANATION-START id=class:CreatePerpendicularCompanionResult

**What this does.** A frozen dataclass returning the companion section row (new or pre-existing) and an ``already_existed`` flag.

**Why it is here.** The caller needs to know whether it created a companion or found one already there, which is the idempotency guarantee made visible.

.. CG-EXPLANATION-END id=class:CreatePerpendicularCompanionResult

Class ``CreatePerpendicularCompanion`` — header
-----------------------------------------------

.. CG-BLOCK id=class:CreatePerpendicularCompanion lines=95-103

.. literalinclude:: ../../../src/groundmodel/application/create_perpendicular_companion.py
   :language: python
   :lines: 95-103
   :lineno-match:

.. CG-EXPLANATION-START id=class:CreatePerpendicularCompanion

**What this does.** Opens the use-case class; its docstring states it takes an active session.

**Why it is here.** Same use-case shape as its neighbours; it inherits ``GroundModelLogger`` for logging under this module's name.

.. CG-EXPLANATION-END id=class:CreatePerpendicularCompanion

Method ``CreatePerpendicularCompanion``. ``def __init__``
---------------------------------------------------------

.. CG-BLOCK id=method:CreatePerpendicularCompanion.__init__ lines=104-108

.. literalinclude:: ../../../src/groundmodel/application/create_perpendicular_companion.py
   :language: python
   :lines: 104-108
   :lineno-match:

.. CG-EXPLANATION-START id=method:CreatePerpendicularCompanion.__init__

**What this does.** Stores the handed-in session and names the logger after this module.

**Why it is here.** The caller owns the session; ``__name__`` makes the log lines read as coming from this use case.

.. CG-EXPLANATION-END id=method:CreatePerpendicularCompanion.__init__

Method ``CreatePerpendicularCompanion``. ``async def execute``
--------------------------------------------------------------

.. CG-BLOCK id=method:CreatePerpendicularCompanion.execute lines=109-281

.. literalinclude:: ../../../src/groundmodel/application/create_perpendicular_companion.py
   :language: python
   :lines: 109-281
   :lineno-match:

.. CG-EXPLANATION-START id=method:CreatePerpendicularCompanion.execute

**What this does.** Runs the pipeline. It loads and scope-guards the body and its model; returns the existing companion if one is already linked; loads the primary section; computes the body's world-space centroid; makes a unit vector perpendicular to the primary section by rotating it ninety degrees; finds the half-length on each side by looking for the nearest investigations; builds the companion's two endpoints; creates the companion cross-section via the repository, tags it as this body's companion, commits, and returns it.

**Why it is here.** The steps follow the docstring's numbered algorithm. The existence guard is the single-companion invariant — enforced here rather than by a database rule because it is a business rule. A *unit vector* is a direction of length one; rotating the primary direction ninety degrees gives the perpendicular bearing. The companion tag is set only after the repository flush hands back the row, because the row's id is needed to link it back to the body.

.. CG-EXPLANATION-END id=method:CreatePerpendicularCompanion.execute

Method ``CreatePerpendicularCompanion``. ``async def _compute_lens_centroid``
-----------------------------------------------------------------------------

.. CG-BLOCK id=method:CreatePerpendicularCompanion._compute_lens_centroid lines=282-381

.. literalinclude:: ../../../src/groundmodel/application/create_perpendicular_companion.py
   :language: python
   :lines: 282-381
   :lineno-match:

.. CG-EXPLANATION-START id=method:CreatePerpendicularCompanion._compute_lens_centroid

**What this does.** Computes the world-space centroid — the average position — of all the formation's contacts for the body. It collects the contacts, resolves each position (a synthetic contact uses its own stored point, an anchored one uses its investigation's location), and averages the x and y; if there are no contacts, or none resolve, it falls back to the midpoint of the primary section.

**Why it is here.** Position 4 architecture: body identity is (model, formation), so the contacts are gathered by that pair rather than by a body-id column. The centroid is where the companion section is centred; the primary-section-midpoint fallback keeps a zero-contact lens from having no anchor at all, per the docstring.

.. CG-EXPLANATION-END id=method:CreatePerpendicularCompanion._compute_lens_centroid

Method ``CreatePerpendicularCompanion``. ``async def _find_half_lengths``
-------------------------------------------------------------------------

.. CG-BLOCK id=method:CreatePerpendicularCompanion._find_half_lengths lines=382-473

.. literalinclude:: ../../../src/groundmodel/application/create_perpendicular_companion.py
   :language: python
   :lines: 382-473
   :lineno-match:

.. CG-EXPLANATION-START id=method:CreatePerpendicularCompanion._find_half_lengths

**What this does.** Decides how far the companion section reaches on each side of the centroid. It loads every investigation in the project, and for each one measures how far along the companion line it sits and how far off to the side; it ignores any beyond the search corridor, then takes the nearest one on the positive side and the nearest on the negative side as the two half-lengths, falling back to the given default when a side has none.

**Why it is here.** The companion is sized to actually reach the surrounding investigations rather than to a fixed length, so it shows real neighbouring data; the corridor width and the per-side fallback are the tuning constants at the top of the file (the Q3 rule from debt #101).

.. CG-EXPLANATION-END id=method:CreatePerpendicularCompanion._find_half_lengths

