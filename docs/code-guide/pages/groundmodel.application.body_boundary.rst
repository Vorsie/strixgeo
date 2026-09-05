groundmodel.application.body_boundary
=====================================

.. CG-PAGE source=src/groundmodel/application/body_boundary.py complete=true

*Source file:* ``src/groundmodel/application/body_boundary.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../src/groundmodel/application/body_boundary.py
   :language: python
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the body-boundary file: a docstring, the imports (the shape and node row types plus ``BodyOrm``), and one constant, ``_VALID_STYLES``, listing the three allowed render styles. The docstring explains that a body's hand-drawn boundary lives as a ``body_boundary_shape`` row (its style and container) plus ordered ``body_boundary_node`` control points, keyed by the body's stable id.

**Why it is here.** This file holds two use cases that share these helpers and rows — the read (``GetBodyBoundary``) and the full-replace save (``SaveBodyBoundary``). The docstring records that the old ``(model_id, content_key)`` lookup was dropped in a schema rename, so the shape is now found by body id; the save commits (like naming a body) while the read changes nothing.

.. CG-EXPLANATION-END id=module-header

Class ``BoundaryNode``
----------------------

.. CG-BLOCK id=class:BoundaryNode lines=31-46

.. literalinclude:: ../../../src/groundmodel/application/body_boundary.py
   :language: python
   :lines: 31-46
   :lineno-match:

.. CG-EXPLANATION-START id=class:BoundaryNode

**What this does.** A frozen dataclass (a set-once data holder) for one control point of a boundary: its distance along the section line in metres and its absolute elevation in metres TAW.

**Why it is here.** The nodes are section-local — measured along one drawn cross-section — so each carries an along-distance and an elevation, the two coordinates the section view draws in.

.. CG-EXPLANATION-END id=class:BoundaryNode

Class ``BodyBoundaryState``
---------------------------

.. CG-BLOCK id=class:BodyBoundaryState lines=47-71

.. literalinclude:: ../../../src/groundmodel/application/body_boundary.py
   :language: python
   :lines: 47-71
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyBoundaryState

**What this does.** A dataclass describing a body's resolved boundary: the body id, the render style, the section the node coordinates belong to, and two ordered lists of nodes — one for the upper boundary, one for the lower.

**Why it is here.** It is the single shape both use cases hand back to the caller (and the desktop). Splitting the nodes into upper and lower matches how a body is drawn between two bounding lines.

.. CG-EXPLANATION-END id=class:BodyBoundaryState

Class ``BodyNotFoundError``
---------------------------

.. CG-BLOCK id=class:BodyNotFoundError lines=72-75

.. literalinclude:: ../../../src/groundmodel/application/body_boundary.py
   :language: python
   :lines: 72-75
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyNotFoundError

**What this does.** An *exception* — an error type the code raises to signal one specific failure — meaning the body does not exist within the given project and model.

**Why it is here.** It is defined so the router can turn this exact case into a 404 'not found' web reply, keeping the not-found decision in one place. It is also the cross-project guard: a body id from another project reads as not found.

.. CG-EXPLANATION-END id=class:BodyNotFoundError

Class ``BodyNoPrimarySectionError``
-----------------------------------

.. CG-BLOCK id=class:BodyNoPrimarySectionError lines=76-79

.. literalinclude:: ../../../src/groundmodel/application/body_boundary.py
   :language: python
   :lines: 76-79
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyNoPrimarySectionError

**What this does.** An exception meaning the body has no primary section to anchor its section-local node coordinates against.

**Why it is here.** The nodes are measured along a specific section, so a body with none cannot store them; the router turns this into a 422 'unprocessable' reply. It holds data only, so it does not log.

.. CG-EXPLANATION-END id=class:BodyNoPrimarySectionError

Function ``async def _load_body_scoped``
----------------------------------------

.. CG-BLOCK id=function:_load_body_scoped lines=80-111

.. literalinclude:: ../../../src/groundmodel/application/body_boundary.py
   :language: python
   :lines: 80-111
   :lineno-match:

.. CG-EXPLANATION-START id=function:_load_body_scoped

**What this does.** A small helper that loads a body row and raises ``BodyNotFoundError`` unless it exists and belongs to both the expected project and the expected model.

**Why it is here.** Both use cases start by resolving the body under scope, so the check lives in one shared helper rather than being copied — and it is the guard that stops one project reading another's body by guessing an id.

.. CG-EXPLANATION-END id=function:_load_body_scoped

Function ``async def _load_nodes``
----------------------------------

.. CG-BLOCK id=function:_load_nodes lines=112-144

.. literalinclude:: ../../../src/groundmodel/application/body_boundary.py
   :language: python
   :lines: 112-144
   :lineno-match:

.. CG-EXPLANATION-START id=function:_load_nodes

**What this does.** A helper that reads a shape's node rows ordered by their stored index and splits them into two lists, upper and lower, each as ``BoundaryNode`` values.

**Why it is here.** Both the read and the save need the saved nodes back in draw order; keeping the ordered read in one helper means the ordering rule is stated once.

.. CG-EXPLANATION-END id=function:_load_nodes

Class ``GetBodyBoundary`` — header
----------------------------------

.. CG-BLOCK id=class:GetBodyBoundary lines=145-153

.. literalinclude:: ../../../src/groundmodel/application/body_boundary.py
   :language: python
   :lines: 145-153
   :lineno-match:

.. CG-EXPLANATION-START id=class:GetBodyBoundary

**What this does.** Opens the read-only use case; its docstring notes it only reads.

**Why it is here.** It is read-only — it never commits — so the desktop can ask for a body's shape without changing anything. It inherits ``GroundModelLogger`` for logging under this module's name.

.. CG-EXPLANATION-END id=class:GetBodyBoundary

Method ``GetBodyBoundary``. ``def __init__``
--------------------------------------------

.. CG-BLOCK id=method:GetBodyBoundary.__init__ lines=154-158

.. literalinclude:: ../../../src/groundmodel/application/body_boundary.py
   :language: python
   :lines: 154-158
   :lineno-match:

.. CG-EXPLANATION-START id=method:GetBodyBoundary.__init__

**What this does.** Stores the handed-in session and names the logger after this module.

**Why it is here.** The caller owns the session; ``__name__`` makes the log lines read as coming from this use case.

.. CG-EXPLANATION-END id=method:GetBodyBoundary.__init__

Method ``GetBodyBoundary``. ``async def execute``
-------------------------------------------------

.. CG-BLOCK id=method:GetBodyBoundary.execute lines=159-209

.. literalinclude:: ../../../src/groundmodel/application/body_boundary.py
   :language: python
   :lines: 159-209
   :lineno-match:

.. CG-EXPLANATION-START id=method:GetBodyBoundary.execute

**What this does.** Loads the body under scope; looks for its shape row; if none exists returns an empty default (no nodes, the 'straight' style, the body's primary section); otherwise loads the nodes and returns the full state.

**Why it is here.** A body with no hand-drawn shape is normal — it just renders on the clean engine default — so the absence returns a sensible empty answer rather than an error, per the docstring.

.. CG-EXPLANATION-END id=method:GetBodyBoundary.execute

Class ``SaveBodyBoundary`` — header
-----------------------------------

.. CG-BLOCK id=class:SaveBodyBoundary lines=210-218

.. literalinclude:: ../../../src/groundmodel/application/body_boundary.py
   :language: python
   :lines: 210-218
   :lineno-match:

.. CG-EXPLANATION-START id=class:SaveBodyBoundary

**What this does.** Opens the full-replace save use case; its docstring notes it commits.

**Why it is here.** Saving a shape is a write, so like naming a body it commits once. It inherits ``GroundModelLogger``.

.. CG-EXPLANATION-END id=class:SaveBodyBoundary

Method ``SaveBodyBoundary``. ``def __init__``
---------------------------------------------

.. CG-BLOCK id=method:SaveBodyBoundary.__init__ lines=219-223

.. literalinclude:: ../../../src/groundmodel/application/body_boundary.py
   :language: python
   :lines: 219-223
   :lineno-match:

.. CG-EXPLANATION-START id=method:SaveBodyBoundary.__init__

**What this does.** Stores the handed-in session and names the logger after this module.

**Why it is here.** The caller owns the session; ``__name__`` makes the log lines read as coming from this use case.

.. CG-EXPLANATION-END id=method:SaveBodyBoundary.__init__

Method ``SaveBodyBoundary``. ``async def execute``
--------------------------------------------------

.. CG-BLOCK id=method:SaveBodyBoundary.execute lines=224-354

.. literalinclude:: ../../../src/groundmodel/application/body_boundary.py
   :language: python
   :lines: 224-354
   :lineno-match:

.. CG-EXPLANATION-START id=method:SaveBodyBoundary.execute

**What this does.** Validates the render style; loads the body under scope; if the body has no primary section it adopts the one the user is editing on (or raises when none is offered); logs the request; takes a per-body advisory lock; *upserts* the shape container (updates it if present, inserts it if not — deleting the old nodes when updating); writes the new nodes for the upper and lower boundaries, sorted along the section and re-indexed; commits; then reads the saved nodes back and returns the state.

**Why it is here.** The comments cite the reasons. The advisory lock — a cooperative 'one writer at a time' marker keyed on model plus body — is taken because the shape editor fires saves about a millisecond apart while the engineer drags nodes, and without it two saves both delete then both insert, and the second dies on the node-order uniqueness rule (dogfeed 2026-05-31); it releases at commit and never touches the read path. A resolver-created lens carries no primary section, so the editor's section is adopted only when none is set, leaving an established body's section unchanged.

.. CG-EXPLANATION-END id=method:SaveBodyBoundary.execute

