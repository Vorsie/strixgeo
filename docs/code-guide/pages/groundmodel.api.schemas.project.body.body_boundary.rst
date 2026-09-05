groundmodel.api.schemas.project.body.body_boundary
==================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/body/body_boundary.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/body/body_boundary.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body/body_boundary.py
   :language: python
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's one-line docstring, its imports, and two module-level values: ``BodyRenderStyle`` (a *Literal* type that fixes the only three allowed strings — ``"straight"``, ``"blocky"``, ``"rounded"``) and ``_MAX_BOUNDARY_NODES``, a cap of 10 000 control points.

**Why it is here.** This page is the reader's first *Pydantic schema* file, so a few terms in one place: a *schema* is a declared shape for the JSON (the plain text format the desktop and engine exchange data in) going in or out of an endpoint; a *field* is one named value in it, each given a *type* (``float``, ``UUID``, a list, ...); *validation* is Pydantic automatically checking incoming JSON against that shape and rejecting a mismatch with a 422. The node cap is a safety limit: the comment records that a real lens boundary has a handful of nodes, so 10 000 stops a malformed request from allocating a huge structure and firing a giant database insert (debt #112).

.. CG-EXPLANATION-END id=module-header

Class ``BodyBoundaryNodeItem``
------------------------------

.. CG-BLOCK id=class:BodyBoundaryNodeItem lines=22-36

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body/body_boundary.py
   :language: python
   :lines: 22-36
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyBoundaryNodeItem

**What this does.** Declares one control node of a body's boundary as two numbers: ``along_m`` (distance along the section line) and ``elevation_m`` (height in metres). It inherits ``StrictRequestModel``.

**Why it is here.** This is the smallest piece of the boundary-shaping request. It inherits the strict base (and MUST, because that strictness does not reach into a *nested* model on its own) so a mistyped key inside a node is rejected rather than ignored. A boundary shape is edited on one cross-section, so the coordinates are section-local, as the docstring states.

.. CG-EXPLANATION-END id=class:BodyBoundaryNodeItem

Class ``BodyBoundaryWriteRequest``
----------------------------------

.. CG-BLOCK id=class:BodyBoundaryWriteRequest lines=37-67

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body/body_boundary.py
   :language: python
   :lines: 37-67
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyBoundaryWriteRequest

**What this does.** The full-replace request for a body's boundary: a list of upper nodes, a list of lower nodes (each defaulting to empty and capped at 10 000), and a render style defaulting to ``"straight"``. A *default* is the value used when the field is omitted.

**Why it is here.** The docstring records that the server sorts and re-indexes the nodes, so the caller need not pre-sort, and an empty list clears that boundary. The per-list cap is the same malformed-request defence as the constant above (debt #112).

.. CG-EXPLANATION-END id=class:BodyBoundaryWriteRequest

Class ``BodyBoundaryResponse``
------------------------------

.. CG-BLOCK id=class:BodyBoundaryResponse lines=68-91

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body/body_boundary.py
   :language: python
   :lines: 68-91
   :lineno-match:

.. CG-EXPLANATION-START id=class:BodyBoundaryResponse

**What this does.** The saved boundary returned to the desktop: the body id, the render style, the section the coordinates belong to, and the stored upper and lower node lists (ascending by distance, empty when no custom shape is stored).

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:BodyBoundaryResponse

