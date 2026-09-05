groundmodel.domain.services.geology_validator
=============================================

.. CG-PAGE source=src/groundmodel/domain/services/geology_validator.py complete=true

*Source file:* ``src/groundmodel/domain/services/geology_validator.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-48

.. literalinclude:: ../../../src/groundmodel/domain/services/geology_validator.py
   :language: python
   :lines: 1-48
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a pure validator for the geological model and imports what it needs: the TIN evaluator (a TIN is a triangulated irregular network, a surface built from triangles through scattered points), the plain data holders for a contact depth, a formation surface and a reported problem, and the logging base. It re-exports two of those holders for older import sites.

**Why it is here.** The validator answers two questions — does one borehole's contacts run cleanly from surface to bottom, and do any two formation surfaces cross in a way that breaks stratigraphic order — and it never raises: bad data is returned as a list of problem items so the editor decides whether to block a save or just warn. It was lifted out of the repository (debt #26) because domain logic does not belong in an infrastructure file, and taking plain data lets any future caller validate without touching the database.

.. CG-EXPLANATION-END id=module-header

Class ``GeologyValidator`` — header
-----------------------------------

.. CG-BLOCK id=class:GeologyValidator lines=49-70

.. literalinclude:: ../../../src/groundmodel/domain/services/geology_validator.py
   :language: python
   :lines: 49-70
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeologyValidator

**What this does.** The validator class. It is stateless, holds a project-standard logger, and defines three tolerances: how close to the surface a contact must sit to count as the surface pick, how close two depths must be to be treated as duplicates, and how much surface overlap counts as touching rather than crossing.

**Why it is here.** The tolerances are set from real measurement noise and explained in the comments: surface picks can be a few centimetres off under soft topsoil, float depths are never exactly equal, and Delaunay interpolation plus survey noise give sub-centimetre overlap that is not a real misordering. Each is generous enough to absorb honest noise but far smaller than a real geological error, which is metres.

.. CG-EXPLANATION-END id=class:GeologyValidator

Method ``GeologyValidator``. ``def __init__``
---------------------------------------------

.. CG-BLOCK id=method:GeologyValidator.__init__ lines=71-74

.. literalinclude:: ../../../src/groundmodel/domain/services/geology_validator.py
   :language: python
   :lines: 71-74
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyValidator.__init__

**What this does.** Sets up the validator with the project-standard logger named after this module.

**Why it is here.** The class inherits the shared logging base, and the convention is that each concrete class passes its own module name so a log line shows where it came from.

.. CG-EXPLANATION-END id=method:GeologyValidator.__init__

Method ``GeologyValidator``. ``def validate_no_gaps``
-----------------------------------------------------

.. CG-BLOCK id=method:GeologyValidator.validate_no_gaps lines=75-185

.. literalinclude:: ../../../src/groundmodel/domain/services/geology_validator.py
   :language: python
   :lines: 75-185
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyValidator.validate_no_gaps

**What this does.** Checks that one borehole's formation contacts form a clean top-to-bottom stratigraphy. It reports when there are no contacts, when the shallowest one sits below the surface tolerance (the top of the hole has no formation), when two contacts share a depth (ambiguous ownership), and when a contact lies deeper than the drilled depth. It sorts the contacts by depth first and returns one problem item per issue, or an empty list when all is well.

**Why it is here.** A gap-free column from surface to bottom is the invariant the geological model rests on, and this surfaces every way it can break in a form the editor can highlight. It sorts internally so callers can pass contacts in any order, and it skips the below-depth check when the drilled depth is unknown because there is then nothing to anchor the bottom against. An empty column is reported too, not as an error but so the editor can flag a borehole the engineer has not started.

.. CG-EXPLANATION-END id=method:GeologyValidator.validate_no_gaps

Method ``GeologyValidator``. ``def validate_no_crossings``
----------------------------------------------------------

.. CG-BLOCK id=method:GeologyValidator.validate_no_crossings lines=186-316

.. literalinclude:: ../../../src/groundmodel/domain/services/geology_validator.py
   :language: python
   :lines: 186-316
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyValidator.validate_no_crossings

**What this does.** Checks that no two formation surfaces break stratigraphic order. For each pair it decides which formation is older from the data — the one whose surface sits lower on average — then samples each surface's points against the other's triangulated surface and flags any point where the younger formation lies below the older. Overlap within the tolerance counts as touching, not crossing. It returns one problem item per offending pair, carrying the worst overlap and the picks involved.

**Why it is here.** Older ground lies deeper by the definition of superposition, so age is read from the elevations rather than from the display order, which is only a drag-and-drop UI preference and, in the natural top-down workflow, runs opposite to any lower-is-older convention — validating against it would false-flag every project built in natural order. The docstring notes the two-way sampling catches a crossing even when only one surface has a point over the other's footprint, and that the cost stays well under a tenth of a second at the model's cardinality.

.. CG-EXPLANATION-END id=method:GeologyValidator.validate_no_crossings

