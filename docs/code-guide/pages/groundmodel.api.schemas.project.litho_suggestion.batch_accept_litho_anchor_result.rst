groundmodel.api.schemas.project.litho_suggestion.batch_accept_litho_anchor_result
=================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_suggestion/batch_accept_litho_anchor_result.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_suggestion/batch_accept_litho_anchor_result.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/batch_accept_litho_anchor_result.py
   :language: python
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports UUID and the base model.

**Why it is here.** A plain response sub-shape, built by us.

.. CG-EXPLANATION-END id=module-header

Class ``BatchAcceptLithoAnchorResult``
--------------------------------------

.. CG-BLOCK id=class:BatchAcceptLithoAnchorResult lines=10-43

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/batch_accept_litho_anchor_result.py
   :language: python
   :lines: 10-43
   :lineno-match:

.. CG-EXPLANATION-START id=class:BatchAcceptLithoAnchorResult

**What this does.** The outcome for one anchor in a batch accept: its identity, the created/found formation and contact ids, and an error string when that anchor was skipped.

**Why it is here.** Echoing the anchor identity plus the same id lists the single accept returns lets the desktop map each result back to its ghost column. The error field lets one bad anchor be skipped (with empty id lists) while the rest of the batch continues, rather than failing the whole request.

.. CG-EXPLANATION-END id=class:BatchAcceptLithoAnchorResult

