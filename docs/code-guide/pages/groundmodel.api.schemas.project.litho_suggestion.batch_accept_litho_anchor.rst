groundmodel.api.schemas.project.litho_suggestion.batch_accept_litho_anchor
==========================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_suggestion/batch_accept_litho_anchor.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_suggestion/batch_accept_litho_anchor.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/batch_accept_litho_anchor.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports UUID, the validator tools, the single suggestion-item shape, and the strict base class.

**Why it is here.** Standard imports for one entry in a batch write body.

.. CG-EXPLANATION-END id=module-header

Class ``BatchAcceptLithoAnchor`` — header
-----------------------------------------

.. CG-BLOCK id=class:BatchAcceptLithoAnchor lines=15-36

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/batch_accept_litho_anchor.py
   :language: python
   :lines: 15-36
   :lineno-match:

.. CG-EXPLANATION-START id=class:BatchAcceptLithoAnchor

**What this does.** One anchor's accepted suggestions inside a batch: its CPT or borehole id and the suggestions to commit for it. It carries no section id.

**Why it is here.** It mirrors the single-accept body but drops the section id, because the batch request carries one shared section id for all anchors (the don't-repeat rule).

.. CG-EXPLANATION-END id=class:BatchAcceptLithoAnchor

Method ``BatchAcceptLithoAnchor``. ``def _exactly_one_anchor``
--------------------------------------------------------------

.. CG-BLOCK id=method:BatchAcceptLithoAnchor._exactly_one_anchor lines=37-42

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_suggestion/batch_accept_litho_anchor.py
   :language: python
   :lines: 37-42
   :lineno-match:

.. CG-EXPLANATION-START id=method:BatchAcceptLithoAnchor._exactly_one_anchor

**What this does.** Rejects the entry unless exactly one anchor id is set.

**Why it is here.** Same one-anchor rule as elsewhere in this package (see the suggest-request page).

.. CG-EXPLANATION-END id=method:BatchAcceptLithoAnchor._exactly_one_anchor

