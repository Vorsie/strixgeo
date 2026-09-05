groundmodel.api.schemas.project.litho_suggestion.batch_accept_litho_suggestions_request
=======================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_suggestion/batch_accept_litho_suggestions_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_suggestion/batch_accept_litho_suggestions_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/batch_accept_litho_suggestions_request.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports UUID, ``Field``, the per-anchor entry shape, and the strict base class.

**Why it is here.** Standard imports for a batch write body composed of per-anchor entries.

.. CG-EXPLANATION-END id=module-header

Class ``BatchAcceptLithoSuggestionsRequest``
--------------------------------------------

.. CG-BLOCK id=class:BatchAcceptLithoSuggestionsRequest lines=15-56

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/batch_accept_litho_suggestions_request.py
   :language: python
   :lines: 15-56
   :lineno-match:

.. CG-EXPLANATION-START id=class:BatchAcceptLithoSuggestionsRequest

**What this does.** The body for accepting many anchors at once: the list of per-anchor entries, one shared section id, a run-inference flag, and the coupling tolerance.

**Why it is here.** Committing all anchors in one transaction — one disk sync, one round-trip instead of one call per anchor — is the bulk-accept performance lever (#153). The shared section id is applied once across all created contacts (explicit-content invariant); run-inference (default true) runs the absence recompute once after the whole batch; the coupling tolerance is forwarded verbatim to each anchor.

.. CG-EXPLANATION-END id=class:BatchAcceptLithoSuggestionsRequest

