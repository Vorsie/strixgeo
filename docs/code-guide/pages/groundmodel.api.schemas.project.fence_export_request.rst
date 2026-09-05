groundmodel.api.schemas.project.fence_export_request
====================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/fence_export_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/fence_export_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/fence_export_request.py
   :language: python
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring and the imports (Pydantic ``Field`` and ``model_validator``, the strict base).

**Why it is here.** The docstring records that the two schemas form one cohesive wire vocabulary and are grouped in a single file — the approved exception to the one-class-per-file rule for a request-schema family.

.. CG-EXPLANATION-END id=module-header

Class ``FenceExportPanel``
--------------------------

.. CG-BLOCK id=class:FenceExportPanel lines=16-57

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/fence_export_request.py
   :language: python
   :lines: 16-57
   :lineno-match:

.. CG-EXPLANATION-START id=class:FenceExportPanel

**What this does.** One filled wall panel of the 3-D fence diagram: its formation id, an optional body id, a display name, a hex colour, and the triangle mesh (a list of 3-D vertices and a list of triangle index triples).

**Why it is here.** The docstring records that the renderer triangulates the panel from the section partition, which the server cannot reconstruct, so this schema RECEIVES the already-built geometry rather than deriving it — and that the colour is resolved at the presentation boundary, so the server must not re-derive it (translate-at-the-presentation-boundary; ``docs/ux.md``). The vertices are in the project's projected coordinate system, not longitude/latitude. A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:FenceExportPanel

Class ``FenceExportRequest`` — header
-------------------------------------

.. CG-BLOCK id=class:FenceExportRequest lines=58-72

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/fence_export_request.py
   :language: python
   :lines: 58-72
   :lineno-match:

.. CG-EXPLANATION-START id=class:FenceExportRequest

**What this does.** The full request: the list of wall panels to serialise. An empty list is valid and exports a well-formed but empty DXF (a CAD drawing file).

**Why it is here.** A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:FenceExportRequest

Method ``FenceExportRequest``. ``def _check_triangle_indices``
--------------------------------------------------------------

.. CG-BLOCK id=method:FenceExportRequest._check_triangle_indices lines=73-100

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/fence_export_request.py
   :language: python
   :lines: 73-100
   :lineno-match:

.. CG-EXPLANATION-START id=method:FenceExportRequest._check_triangle_indices

**What this does.** A whole-object check that every triangle's vertex indices are within range for its panel, raising a ``ValueError`` naming the panel, triangle, and offending index otherwise.

**Why it is here.** The docstring records why it fails loudly: a dropped or clamped face would ship a hole in a deliverable the engineer opens directly in CAD, so it must be refused with a 422 at the API boundary rather than reach the exporter.

.. CG-EXPLANATION-END id=method:FenceExportRequest._check_triangle_indices

