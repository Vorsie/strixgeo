groundmodel.application.accept_contact_correlations
===================================================

.. CG-PAGE source=src/groundmodel/application/accept_contact_correlations.py complete=true

*Source file:* ``src/groundmodel/application/accept_contact_correlations.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-47

.. literalinclude:: ../../../src/groundmodel/application/accept_contact_correlations.py
   :language: python
   :lines: 1-47
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening docstring and imports for the use case that approves unapproved contact-correlation edges. The docstring lays out the three scopes — one edge, one section, or the whole model — and states that after approving it runs the resolver in the same transaction; the imports pull in the partition lock, the resolver, the scope guard, and the row types.

**Why it is here.** The docstring records the scope rules and their triggers: edge-scoped from the right-click menu on one edge (dogfeed 2026-05-31), section-scoped for edges authored on one section, model-scoped for all unapproved edges. It states the commit boundary is owned here — the resolver is called without its own commit so the approval and the resolver result land in one atomic transaction — and that body detection is deliberately not fired (owner directive 2026-05-31); body membership is managed by the resolver and stale body rows are reconciled by the startup or restore sweep.

.. CG-EXPLANATION-END id=module-header

Class ``AcceptResult``
----------------------

.. CG-BLOCK id=class:AcceptResult lines=48-64

.. literalinclude:: ../../../src/groundmodel/application/accept_contact_correlations.py
   :language: python
   :lines: 48-64
   :lineno-match:

.. CG-EXPLANATION-START id=class:AcceptResult

**What this does.** A dataclass reporting how many edges were flipped to approved and how many formations had their instance-ordinal number changed by the resolver step.

**Why it is here.** The two counts are the honest report: what the engineer approved, and what the downstream resolver moved as a result, so a caller can show both without re-querying.

.. CG-EXPLANATION-END id=class:AcceptResult

Class ``AcceptContactCorrelations`` — header
--------------------------------------------

.. CG-BLOCK id=class:AcceptContactCorrelations lines=65-76

.. literalinclude:: ../../../src/groundmodel/application/accept_contact_correlations.py
   :language: python
   :lines: 65-76
   :lineno-match:

.. CG-EXPLANATION-START id=class:AcceptContactCorrelations

**What this does.** The use-case class header, inheriting the logger.

**Why it is here.** The docstring restates the scoped-versus-model-wide behaviour and that after flipping approval it re-runs the resolver to refresh instance ordinals in the same transaction, deliberately omitting lens detection.

.. CG-EXPLANATION-END id=class:AcceptContactCorrelations

Method ``AcceptContactCorrelations``. ``def __init__``
------------------------------------------------------

.. CG-BLOCK id=method:AcceptContactCorrelations.__init__ lines=77-81

.. literalinclude:: ../../../src/groundmodel/application/accept_contact_correlations.py
   :language: python
   :lines: 77-81
   :lineno-match:

.. CG-EXPLANATION-START id=method:AcceptContactCorrelations.__init__

**What this does.** The setup step: stores the caller's database session.

**Why it is here.** The caller owns the session; this use case commits once at the end.

.. CG-EXPLANATION-END id=method:AcceptContactCorrelations.__init__

Method ``AcceptContactCorrelations``. ``async def execute``
-----------------------------------------------------------

.. CG-BLOCK id=method:AcceptContactCorrelations.execute lines=82-234

.. literalinclude:: ../../../src/groundmodel/application/accept_contact_correlations.py
   :language: python
   :lines: 82-234
   :lineno-match:

.. CG-EXPLANATION-START id=method:AcceptContactCorrelations.execute

**What this does.** The entry point. It scope-guards the model, builds the in-scope set of unapproved edge ids (one edge, or a section's edges, or the whole model's), takes the partition lock, flips those edges to approved, re-runs the resolver without committing, then commits once and returns the counts.

**Why it is here.** Each scope path is guarded: an edge id is checked to belong to the model, and a section id is checked to belong to the project, before the query runs. The section scope reads the edges authored on that section, which replaced an older set-intersection so the render gate and the accept gate now read the same section scope (owner directive 2026-06-08). The partition lock is taken after every guard has passed and before the approval flip, because that write would otherwise race the debounced background body-recompute re-stamping the same rows in a different order (owner dogfeed 2026-08-23, a deadlock); the lock is re-entrant so the resolver's later take stays free. The resolver runs without its own commit so approval and resolver result are one atomic unit.

.. CG-EXPLANATION-END id=method:AcceptContactCorrelations.execute

