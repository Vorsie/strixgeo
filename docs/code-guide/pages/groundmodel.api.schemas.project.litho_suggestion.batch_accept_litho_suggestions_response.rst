groundmodel.api.schemas.project.litho_suggestion.batch_accept_litho_suggestions_response
========================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_suggestion/batch_accept_litho_suggestions_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_suggestion/batch_accept_litho_suggestions_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/batch_accept_litho_suggestions_response.py
   :language: python
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the base model, the section response shape, and the per-anchor result shape.

**Why it is here.** The reply embeds both, so it imports both.

.. CG-EXPLANATION-END id=module-header

Class ``BatchAcceptLithoSuggestionsResponse``
---------------------------------------------

.. CG-BLOCK id=class:BatchAcceptLithoSuggestionsResponse lines=13-43

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/batch_accept_litho_suggestions_response.py
   :language: python
   :lines: 13-43
   :lineno-match:

.. CG-EXPLANATION-START id=class:BatchAcceptLithoSuggestionsResponse

**What this does.** The reply for a batch accept: the per-anchor outcomes in request order, running totals of created/found contacts and created formations, the count of failed anchors, whether inference ran, and the refreshed section.

**Why it is here.** The per-anchor results in request order let the desktop update each ghost column and build per-anchor undo entries; the totals and the failed count give a one-glance summary; the refreshed section (seeded once with every anchor's contacts) rides back so the section view updates in place.

.. CG-EXPLANATION-END id=class:BatchAcceptLithoSuggestionsResponse

