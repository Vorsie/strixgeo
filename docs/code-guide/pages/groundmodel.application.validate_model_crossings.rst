groundmodel.application.validate_model_crossings
================================================

.. CG-PAGE source=src/groundmodel/application/validate_model_crossings.py complete=true

*Source file:* ``src/groundmodel/application/validate_model_crossings.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-44

.. literalinclude:: ../../../src/groundmodel/application/validate_model_crossings.py
   :language: python
   :lines: 1-44
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the crossing-validator use case. It imports the pure geology validator with its surface-input type, the surface mesh type, the issue value object, the borehole/CPT/contact/formation/model rows, the geology repository, the set of non-stratigraphic model kinds, and the logger.

**Why it is here.** The docstring records the job: walk every cached formation surface in a geological model and hand them to the validator, which returns one issue per pair of surfaces that break the stratigraphic-order superposition rule (an older surface must not sit above a younger one). It is read-only; the frontend shows the list as inline warnings.

.. CG-EXPLANATION-END id=module-header

Class ``ValidateModelCrossings`` — header
-----------------------------------------

.. CG-BLOCK id=class:ValidateModelCrossings lines=45-47

.. literalinclude:: ../../../src/groundmodel/application/validate_model_crossings.py
   :language: python
   :lines: 45-47
   :lineno-match:

.. CG-EXPLANATION-START id=class:ValidateModelCrossings

**What this does.** Declares the use-case class that runs the cross-formation crossing check for one model.

**Why it is here.** Why: recorded in the class + module docstrings.

.. CG-EXPLANATION-END id=class:ValidateModelCrossings

Method ``ValidateModelCrossings``. ``def __init__``
---------------------------------------------------

.. CG-BLOCK id=method:ValidateModelCrossings.__init__ lines=48-53

.. literalinclude:: ../../../src/groundmodel/application/validate_model_crossings.py
   :language: python
   :lines: 48-53
   :lineno-match:

.. CG-EXPLANATION-START id=method:ValidateModelCrossings.__init__

**What this does.** Stores the session and builds the geology repository over it, and names the logger.

**Why it is here.** Same session-owned pattern as the other validators; it needs both the raw session (for bulk id lookups) and the repository (for the surface and contact lists).

.. CG-EXPLANATION-END id=method:ValidateModelCrossings.__init__

Method ``ValidateModelCrossings``. ``async def execute``
--------------------------------------------------------

.. CG-BLOCK id=method:ValidateModelCrossings.execute lines=54-190

.. literalinclude:: ../../../src/groundmodel/application/validate_model_crossings.py
   :language: python
   :lines: 54-190
   :lineno-match:

.. CG-EXPLANATION-START id=method:ValidateModelCrossings.execute

**What this does.** Returns the crossing issues for the model. It first skips non-stratigraphic model kinds, loads the cached surfaces, and returns early if there are none. It bulk-loads the referenced formations for their display order and name, builds a per-formation lookup from rounded (easting, northing) to contact id so the validator can name the offending picks, packages each surface with its metadata, and delegates to the pure validator.

**Why it is here.** The skip is spelled out: interfingering units in litho and geotech models — sand both above and below a clay at different places — are real geology, not superposition errors, so the rule is meaningless there and the frontend shows no banner. The one-query-for-the-whole-model contact fetch replaced a per-formation fan-out that stalled the post-edit poll on large models (debt #49). The coordinates are rounded to centimetres to match the validator's own keying, enough to disambiguate any real survey grid without colliding on noise.

.. CG-EXPLANATION-END id=method:ValidateModelCrossings.execute

