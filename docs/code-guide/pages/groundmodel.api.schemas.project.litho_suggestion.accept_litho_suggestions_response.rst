groundmodel.api.schemas.project.litho_suggestion.accept_litho_suggestions_response
==================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_suggestion/accept_litho_suggestions_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_suggestion/accept_litho_suggestions_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/accept_litho_suggestions_response.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports UUID, the base model, and the section response shape.

**Why it is here.** The reply embeds the refreshed section, so it imports that shape.

.. CG-EXPLANATION-END id=module-header

Class ``AcceptLithoSuggestionsResponse``
----------------------------------------

.. CG-BLOCK id=class:AcceptLithoSuggestionsResponse lines=12-35

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/accept_litho_suggestions_response.py
   :language: python
   :lines: 12-35
   :lineno-match:

.. CG-EXPLANATION-START id=class:AcceptLithoSuggestionsResponse

**What this does.** The reply for an accept: the formation ids created versus re-used, the contact ids created versus already present, and the refreshed section when one was seeded.

**Why it is here.** Separating created from found ids makes the accept *idempotent* — re-accepting the same suggestions re-uses existing rows rather than duplicating them, and the caller can see which happened. The refreshed section rides back so the desktop updates in place.

.. CG-EXPLANATION-END id=class:AcceptLithoSuggestionsResponse

