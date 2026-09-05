groundmodel.api.schemas.project.litho_suggestion.accept_litho_suggestions_request
=================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_suggestion/accept_litho_suggestions_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_suggestion/accept_litho_suggestions_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/accept_litho_suggestions_request.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports UUID, the validator tools, the single suggestion-item shape, and the strict base class.

**Why it is here.** Standard imports for a write body that embeds a list of items and runs a whole-object check.

.. CG-EXPLANATION-END id=module-header

Class ``AcceptLithoSuggestionsRequest`` — header
------------------------------------------------

.. CG-BLOCK id=class:AcceptLithoSuggestionsRequest lines=15-80

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/accept_litho_suggestions_request.py
   :language: python
   :lines: 15-80
   :lineno-match:

.. CG-EXPLANATION-START id=class:AcceptLithoSuggestionsRequest

**What this does.** The body for committing accepted suggestions for one investigation: the anchor (CPT or borehole), an optional section id, the suggestions to commit (at least one), a defer-inference flag, and a coupling tolerance.

**Why it is here.** The optional section id carries the explicit-content invariant — accepted contacts are added to that section's shown-content list so they appear immediately. The defer-inference flag lets seeding scripts and fixtures skip the per-accept inference pass while still committing contacts; production bulk flows use the batch endpoint instead. The coupling tolerance (default 0.20 m) is the distance within which a litho contact is snapped and linked to a coincident geological contact (#162), sourced from the desktop's snap preference.

.. CG-EXPLANATION-END id=class:AcceptLithoSuggestionsRequest

Method ``AcceptLithoSuggestionsRequest``. ``def _exactly_one_anchor``
---------------------------------------------------------------------

.. CG-BLOCK id=method:AcceptLithoSuggestionsRequest._exactly_one_anchor lines=81-88

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/accept_litho_suggestions_request.py
   :language: python
   :lines: 81-88
   :lineno-match:

.. CG-EXPLANATION-START id=method:AcceptLithoSuggestionsRequest._exactly_one_anchor

**What this does.** Rejects the request unless exactly one anchor id is set.

**Why it is here.** Same one-anchor rule as the suggest request — an ambiguous target is a ``422`` at the boundary (see the suggest-request page).

.. CG-EXPLANATION-END id=method:AcceptLithoSuggestionsRequest._exactly_one_anchor

