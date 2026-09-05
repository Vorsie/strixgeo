groundmodel.application.batch_accept_litho_suggestions
======================================================

.. CG-PAGE source=src/groundmodel/application/batch_accept_litho_suggestions.py complete=true

*Source file:* ``src/groundmodel/application/batch_accept_litho_suggestions.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../src/groundmodel/application/batch_accept_litho_suggestions.py
   :language: python
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the batch-accept file. It imports the single-accept use case and result, the body-partition locks, and the suggestion type, and its docstring explains why the batch exists.

**Why it is here.** The frontend's accept-all fires one request per anchor, so an N-anchor accept costs N commits and N round-trips; this use case runs every anchor with the commit and inference deferred and commits once, turning the whole bulk accept into one transaction (issue #153).

.. CG-EXPLANATION-END id=module-header

Class ``BatchAcceptAnchorInput``
--------------------------------

.. CG-BLOCK id=class:BatchAcceptAnchorInput lines=38-56

.. literalinclude:: ../../../src/groundmodel/application/batch_accept_litho_suggestions.py
   :language: python
   :lines: 38-56
   :lineno-match:

.. CG-EXPLANATION-START id=class:BatchAcceptAnchorInput

**What this does.** A frozen dataclass carrying one anchor's suggestions and its CPT or borehole id.

**Why it is here.** One input per investigation, with the two anchor ids mutually exclusive.

.. CG-EXPLANATION-END id=class:BatchAcceptAnchorInput

Class ``BatchAnchorOutcome``
----------------------------

.. CG-BLOCK id=class:BatchAnchorOutcome lines=57-78

.. literalinclude:: ../../../src/groundmodel/application/batch_accept_litho_suggestions.py
   :language: python
   :lines: 57-78
   :lineno-match:

.. CG-EXPLANATION-START id=class:BatchAnchorOutcome

**What this does.** A frozen dataclass reporting one anchor's outcome inside the batch: its anchor id, the accept result, or the error message when it was skipped.

**Why it is here.** Echoing the anchor id back lets the frontend map each outcome to its investigation; a skipped anchor carries its reason instead of a result.

.. CG-EXPLANATION-END id=class:BatchAnchorOutcome

Class ``BatchAcceptResult``
---------------------------

.. CG-BLOCK id=class:BatchAcceptResult lines=79-100

.. literalinclude:: ../../../src/groundmodel/application/batch_accept_litho_suggestions.py
   :language: python
   :lines: 79-100
   :lineno-match:

.. CG-EXPLANATION-START id=class:BatchAcceptResult

**What this does.** A dataclass for the whole batch: the per-anchor outcomes in order, whether the single commit ran, and the set of geological formations snapped across all anchors.

**Why it is here.** The snapped-formations set lets the router rebuild the geological surfaces once after the batch instead of once per anchor (issue #162).

.. CG-EXPLANATION-END id=class:BatchAcceptResult

Class ``BatchAcceptLithoSuggestions`` — header
----------------------------------------------

.. CG-BLOCK id=class:BatchAcceptLithoSuggestions lines=101-110

.. literalinclude:: ../../../src/groundmodel/application/batch_accept_litho_suggestions.py
   :language: python
   :lines: 101-110
   :lineno-match:

.. CG-EXPLANATION-START id=class:BatchAcceptLithoSuggestions

**What this does.** The use case that accepts many anchors in one transaction.

**Why it is here.** The docstring records that it commits once at the end, so the caller must not commit before calling it.

.. CG-EXPLANATION-END id=class:BatchAcceptLithoSuggestions

Method ``BatchAcceptLithoSuggestions``. ``def __init__``
--------------------------------------------------------

.. CG-BLOCK id=method:BatchAcceptLithoSuggestions.__init__ lines=111-115

.. literalinclude:: ../../../src/groundmodel/application/batch_accept_litho_suggestions.py
   :language: python
   :lines: 111-115
   :lineno-match:

.. CG-EXPLANATION-START id=method:BatchAcceptLithoSuggestions.__init__

**What this does.** Stores the session.

**Why it is here.** The caller owns the session; the batch commits it once.

.. CG-EXPLANATION-END id=method:BatchAcceptLithoSuggestions.__init__

Method ``BatchAcceptLithoSuggestions``. ``async def execute``
-------------------------------------------------------------

.. CG-BLOCK id=method:BatchAcceptLithoSuggestions.execute lines=116-271

.. literalinclude:: ../../../src/groundmodel/application/batch_accept_litho_suggestions.py
   :language: python
   :lines: 116-271
   :lineno-match:

.. CG-EXPLANATION-START id=method:BatchAcceptLithoSuggestions.execute

**What this does.** Builds the shared batch context once, takes the model's body-partition lock once, then accepts every anchor with commit and inference deferred, recomputes display order once, and commits once — reporting the outcomes and the aggregated snapped-geo set.

**Why it is here.** Loading the context and taking the lock once for the whole batch avoids per-anchor re-loads and repeated lock takes (advisory locks are re-entrant, but one take keeps the log clean); the display-order recompute is deferred and run once because running it per anchor scans the growing contact set and would be quadratic. A per-anchor error is raised before any write, so recording it and continuing keeps the shared transaction clean.

.. CG-EXPLANATION-END id=method:BatchAcceptLithoSuggestions.execute

