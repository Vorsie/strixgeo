groundmodel.application.move_litho_layer_boundary
=================================================

.. CG-PAGE source=src/groundmodel/application/move_litho_layer_boundary.py complete=true

*Source file:* ``src/groundmodel/application/move_litho_layer_boundary.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-60

.. literalinclude:: ../../../src/groundmodel/application/move_litho_layer_boundary.py
   :language: python
   :lines: 1-60
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening docstring and imports for the use case that moves the shared boundary between two stacked layers. The docstring explains the operation, the four validation checks it applies, and its trivial idempotency; the imports pull in the partition locks, the layer row type and its repository, and the database integrity-error type.

**Why it is here.** The docstring records the design: this is the server-side replacement for the old client-side cross-merge on drag. It moves the upper layer's base and the lower layer's top to the same new depth in one transaction (an all-or-nothing unit of work). The four checks are spelled out with their reasons: both layers must exist and belong to the model (an id-guessing guard), they must be on the same investigation column, they must currently be adjacent, and the new depth must leave both at least a minimum thickness. That last rule is stricter than a plain ordering check because a near-zero-thickness result rounds to a degenerate range and would trip the database's no-overlap rule as an unhandled server error, so it is rejected cleanly instead.

.. CG-EXPLANATION-END id=module-header

Class ``BoundaryMoveError``
---------------------------

.. CG-BLOCK id=class:BoundaryMoveError lines=61-64

.. literalinclude:: ../../../src/groundmodel/application/move_litho_layer_boundary.py
   :language: python
   :lines: 61-64
   :lineno-match:

.. CG-EXPLANATION-START id=class:BoundaryMoveError

**What this does.** A small custom error type, raised when the requested move breaks one of the invariants.

**Why it is here.** It subclasses the standard value-error so the router can catch it and turn it into an HTTP 422 (the status meaning the request was well-formed but semantically invalid) rather than a 500 server error. The docstring says exactly that: router maps it to 422.

.. CG-EXPLANATION-END id=class:BoundaryMoveError

Class ``BoundaryMoveResult``
----------------------------

.. CG-BLOCK id=class:BoundaryMoveResult lines=65-72

.. literalinclude:: ../../../src/groundmodel/application/move_litho_layer_boundary.py
   :language: python
   :lines: 65-72
   :lineno-match:

.. CG-EXPLANATION-START id=class:BoundaryMoveResult

**What this does.** A dataclass (a small class whose only job is to hold named values together) carrying the two updated layer rows, the upper and the lower, after a successful move.

**Why it is here.** It gives the caller both changed rows to return to the desktop, so the front end can redraw the two layers without re-fetching the whole column.

.. CG-EXPLANATION-END id=class:BoundaryMoveResult

Class ``MoveLithoLayerBoundary`` — header
-----------------------------------------

.. CG-BLOCK id=class:MoveLithoLayerBoundary lines=73-75

.. literalinclude:: ../../../src/groundmodel/application/move_litho_layer_boundary.py
   :language: python
   :lines: 73-75
   :lineno-match:

.. CG-EXPLANATION-START id=class:MoveLithoLayerBoundary

**What this does.** The use-case class header. One line, declaring the class and inheriting the logger.

**Why it is here.** The docstring states its single job: atomically move the shared boundary between two adjacent layers. Atomic means both row changes happen together or not at all.

.. CG-EXPLANATION-END id=class:MoveLithoLayerBoundary

Method ``MoveLithoLayerBoundary``. ``def __init__``
---------------------------------------------------

.. CG-BLOCK id=method:MoveLithoLayerBoundary.__init__ lines=76-81

.. literalinclude:: ../../../src/groundmodel/application/move_litho_layer_boundary.py
   :language: python
   :lines: 76-81
   :lineno-match:

.. CG-EXPLANATION-START id=method:MoveLithoLayerBoundary.__init__

**What this does.** The setup step: it stores the caller's database session and builds the litho-layer repository.

**Why it is here.** The caller owns the session and its commit boundary; this class only does the reads, the writes and the single commit at the end of ``execute``.

.. CG-EXPLANATION-END id=method:MoveLithoLayerBoundary.__init__

Method ``MoveLithoLayerBoundary``. ``async def execute``
--------------------------------------------------------

.. CG-BLOCK id=method:MoveLithoLayerBoundary.execute lines=82-231

.. literalinclude:: ../../../src/groundmodel/application/move_litho_layer_boundary.py
   :language: python
   :lines: 82-231
   :lineno-match:

.. CG-EXPLANATION-START id=method:MoveLithoLayerBoundary.execute

**What this does.** The entry point. It loads the two named layers, checks they exist and share an anchor, checks they are currently adjacent, checks the new depth leaves both thick enough, takes the two partition locks, sets the upper base and lower top to the new depth, carries the coupled geological contact along if there is one, marks the surfaces and the 3-D cache stale, then flushes and commits, refreshing both rows before returning them.

**Why it is here.** Every guard has its recorded reason. The same-anchor and adjacency checks reject a caller that picked the wrong pair. The thickness guard turns a would-be database no-overlap failure into a clean 422, and a defence-in-depth catch turns any residual integrity error at commit into a 422 too rather than a 500. The locks are taken after validation (so a rejected move does not queue behind a live writer) and before the first write, in the resolver's canonical order — own litho lock first, then the sibling geotech child — to avoid the same background-recompute deadlock the other litho writers guard against. The coupled geological contact rides along in the SAME transaction because a litho boundary derived from geology IS that geological surface; moving one and not the other would split one physical surface into two records that disagree, with nothing downstream reporting it. Marking the surface stale (not rebuilding it) follows the on-click build rule: only the explicit Build button runs the interpolation. The final refresh avoids a lazy database read of the server-set update timestamp outside the async context.

.. CG-EXPLANATION-END id=method:MoveLithoLayerBoundary.execute

