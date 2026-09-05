groundmodel.api.schemas.project.litho_suggestion.litho_suggestion_response
==========================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_suggestion/litho_suggestion_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_suggestion/litho_suggestion_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/litho_suggestion_response.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the base model and the single suggestion-item shape.

**Why it is here.** The reply is built by us and is not validated from client input, so it uses the plain base model, not the strict one.

.. CG-EXPLANATION-END id=module-header

Class ``LithoSuggestionResponse``
---------------------------------

.. CG-BLOCK id=class:LithoSuggestionResponse lines=10-31

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/litho_suggestion_response.py
   :language: python
   :lines: 10-31
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoSuggestionResponse

**What this does.** The reply for a suggest request: which data source was used, the minimum thickness that was applied, and the ordered list of suggested layers.

**Why it is here.** Echoing the threshold back lets the desktop re-request with a different value without losing context. An empty layer list is a valid answer (the segmenter produced nothing).

.. CG-EXPLANATION-END id=class:LithoSuggestionResponse

