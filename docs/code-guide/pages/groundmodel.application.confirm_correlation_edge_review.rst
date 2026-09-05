groundmodel.application.confirm_correlation_edge_review
=======================================================

.. CG-PAGE source=src/groundmodel/application/confirm_correlation_edge_review.py complete=true

*Source file:* ``src/groundmodel/application/confirm_correlation_edge_review.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../src/groundmodel/application/confirm_correlation_edge_review.py
   :language: python
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening docstring and imports for the use case that clears the review flag on correlation edges the engineer has confirmed. The docstring has three parts — why this exists, what it does NOT do — and the imports pull in the database update builder, the session type and the edge row type.

**Why it is here.** The docstring records the whole rationale. A re-subdivide can leave an accepted geotech tie attached to a band that is not obviously the one it was drawn on, so those ties are carried and stamped with a review reason rather than deleted, because the owner's rule (2026-08-02) is that an accepted edge never disappears without the engineer deleting it. This use case is the other half: the engineer looks at a flagged tie and either deletes it or confirms it is right, which is this. Without it the flag would be permanent. It deliberately changes no geometry and no approval state — a flagged edge is already approved, awaiting confirmation, so only the flag is dropped.

.. CG-EXPLANATION-END id=module-header

Class ``ConfirmCorrelationEdgeReviewResult``
--------------------------------------------

.. CG-BLOCK id=class:ConfirmCorrelationEdgeReviewResult lines=38-51

.. literalinclude:: ../../../src/groundmodel/application/confirm_correlation_edge_review.py
   :language: python
   :lines: 38-51
   :lineno-match:

.. CG-EXPLANATION-START id=class:ConfirmCorrelationEdgeReviewResult

**What this does.** A frozen dataclass reporting how many edges actually had a flag cleared.

**Why it is here.** Zero is a normal answer, not an error — confirming an already-unflagged edge is a no-op — so the count lets the caller report exactly what happened.

.. CG-EXPLANATION-END id=class:ConfirmCorrelationEdgeReviewResult

Class ``ConfirmCorrelationEdgeReview`` — header
-----------------------------------------------

.. CG-BLOCK id=class:ConfirmCorrelationEdgeReview lines=52-60

.. literalinclude:: ../../../src/groundmodel/application/confirm_correlation_edge_review.py
   :language: python
   :lines: 52-60
   :lineno-match:

.. CG-EXPLANATION-START id=class:ConfirmCorrelationEdgeReview

**What this does.** The use-case class header, inheriting the logger.

**Why it is here.** The docstring states its job: drop the review reason from one edge or from a whole model, with the caller owning the session.

.. CG-EXPLANATION-END id=class:ConfirmCorrelationEdgeReview

Method ``ConfirmCorrelationEdgeReview``. ``def __init__``
---------------------------------------------------------

.. CG-BLOCK id=method:ConfirmCorrelationEdgeReview.__init__ lines=61-65

.. literalinclude:: ../../../src/groundmodel/application/confirm_correlation_edge_review.py
   :language: python
   :lines: 61-65
   :lineno-match:

.. CG-EXPLANATION-START id=method:ConfirmCorrelationEdgeReview.__init__

**What this does.** The setup step: stores the caller's database session.

**Why it is here.** The caller owns the session; this use case commits once at the end.

.. CG-EXPLANATION-END id=method:ConfirmCorrelationEdgeReview.__init__

Method ``ConfirmCorrelationEdgeReview``. ``async def execute``
--------------------------------------------------------------

.. CG-BLOCK id=method:ConfirmCorrelationEdgeReview.execute lines=66-115

.. literalinclude:: ../../../src/groundmodel/application/confirm_correlation_edge_review.py
   :language: python
   :lines: 66-115
   :lineno-match:

.. CG-EXPLANATION-START id=method:ConfirmCorrelationEdgeReview.execute

**What this does.** The entry point. It builds an update that clears the review reason on the model's flagged edges, narrows it to one edge when an edge id is given, runs it, commits, and returns the count of flags cleared.

**Why it is here.** The statement always constrains by model, so an edge id from a different model matches nothing rather than being confirmed across the model boundary. The comment explains it restricts to already-flagged rows on purpose, so the row count means flags cleared rather than rows touched — re-confirming then reports zero instead of looking like work happened. Passing no edge id confirms every flagged edge of the model, the confirm-all path.

.. CG-EXPLANATION-END id=method:ConfirmCorrelationEdgeReview.execute

