groundmodel.api.schemas.project.litho_contact_correlation.accept_schemas
========================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_contact_correlation/accept_schemas.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_contact_correlation/accept_schemas.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_contact_correlation/accept_schemas.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring, then imports of ``UUID``, ``BaseModel``, and the strict base.

**Why it is here.** This file holds the request and responses for the accept endpoints; the request uses the strict base.

.. CG-EXPLANATION-END id=module-header

Class ``AcceptContactCorrelationsRequest``
------------------------------------------

.. CG-BLOCK id=class:AcceptContactCorrelationsRequest lines=12-25

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_contact_correlation/accept_schemas.py
   :language: python
   :lines: 12-25
   :lineno-match:

.. CG-EXPLANATION-START id=class:AcceptContactCorrelationsRequest

**What this does.** The body of the accept endpoint: an optional section id — approve only edges whose endpoints are both seeded on that section, or every unapproved edge in the model when absent.

**Why it is here.** Same request-schema pattern; scoping to a section lets the engineer accept one section's correlations at a time.

.. CG-EXPLANATION-END id=class:AcceptContactCorrelationsRequest

Class ``AcceptContactCorrelationsResponse``
-------------------------------------------

.. CG-BLOCK id=class:AcceptContactCorrelationsResponse lines=26-43

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_contact_correlation/accept_schemas.py
   :language: python
   :lines: 26-43
   :lineno-match:

.. CG-EXPLANATION-START id=class:AcceptContactCorrelationsResponse

**What this does.** The result of accepting: how many edges were flipped to approved, and a diagnostic count of formation-ordinal changes the resolver triggered.

**Why it is here.** The ordinal count is populated only once the resolver exposes per-change counts; zero until then, as the docstring notes.

.. CG-EXPLANATION-END id=class:AcceptContactCorrelationsResponse

Class ``ConfirmEdgeReviewResponse``
-----------------------------------

.. CG-BLOCK id=class:ConfirmEdgeReviewResponse lines=44-55

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_contact_correlation/accept_schemas.py
   :language: python
   :lines: 44-55
   :lineno-match:

.. CG-EXPLANATION-START id=class:ConfirmEdgeReviewResponse

**What this does.** The result of confirming a flagged edge: how many edges had their review flag cleared.

**Why it is here.** The docstring notes zero is a normal answer — confirming an edge that carries no flag is a no-op, not an error — so the desktop should not treat it as a failure.

.. CG-EXPLANATION-END id=class:ConfirmEdgeReviewResponse

