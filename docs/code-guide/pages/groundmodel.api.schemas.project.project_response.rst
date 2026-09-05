groundmodel.api.schemas.project.project_response
================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/project_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/project_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_response.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports datetime, the free-form ``Any`` type, UUID, and the Pydantic base tools.

**Why it is here.** ``Any`` is used for the free-form settings dictionaries below, whose inner shape the read path deliberately does not police.

.. CG-EXPLANATION-END id=module-header

Class ``ProjectResponse``
-------------------------

.. CG-BLOCK id=class:ProjectResponse lines=12-70

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_response.py
   :language: python
   :lines: 12-70
   :lineno-match:

.. CG-EXPLANATION-START id=class:ProjectResponse

**What this does.** The full metadata shape returned for a project: id, name, number, client, site, description, tags, coordinate systems, phase, status, archive/created/updated times, a free-form view-state dictionary, and the two stratigraphy-lumping snapshots plus a revision counter. It sets ``from_attributes=True`` so it reads straight off the database row.

**Why it is here.** The same shape serves both the list and detail endpoints because a project is metadata-only with no heavy children, and the desktop serialises it straight into the saved ``.gmproj`` file. The long comment records a hard-won decision: the two lumping snapshots are typed as free-form pass-through dictionaries, NOT as the validated lumping schema, because this response reads straight off the row and the list endpoint returns many of them — one project whose stored JSON failed validation would crash (``500``) the entire project list and take down the start screen. Validation belongs on the write path; the read path stays pass-through, exactly like view-state. A ``None`` lumping means "no lumping map", which is deliberately different from a snapshot whose map is empty. All these fields are additive and optional, so bundles written before the columns existed still open.

.. CG-EXPLANATION-END id=class:ProjectResponse

