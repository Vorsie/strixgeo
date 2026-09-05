groundmodel.api.schemas.project.project_create_request
======================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/project_create_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/project_create_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_create_request.py
   :language: python
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the ``Literal`` type and the Pydantic validator tools, then defines two fixed vocabularies — the allowed project phases and statuses — as ``Literal`` types.

**Why it is here.** A ``Literal`` type restricts a field to an exact set of allowed strings, rejecting anything else with a ``422``. The comment records that phase and status are stored as plain text in the database (no fixed database enum), so adding a value here needs no database migration — the schema is the only enforcement point.

.. CG-EXPLANATION-END id=module-header

Class ``ProjectCreateRequest`` — header
---------------------------------------

.. CG-BLOCK id=class:ProjectCreateRequest lines=18-27

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_create_request.py
   :language: python
   :lines: 18-27
   :lineno-match:

.. CG-EXPLANATION-START id=class:ProjectCreateRequest

**What this does.** The body for creating a project. Only the name is required (1–200 characters); every other field — number, client, site label, description, tags, coordinate systems, phase, status — is optional with a sensible default.

**Why it is here.** Making name the only required field lets the engineer create a project quickly and fill in details later, per the docstring. Each ``Field(max_length=...)`` caps a text length so an over-long value is rejected at the boundary.

.. CG-EXPLANATION-END id=class:ProjectCreateRequest

Method ``ProjectCreateRequest``. ``def name_must_not_be_whitespace_only``
-------------------------------------------------------------------------

.. CG-BLOCK id=method:ProjectCreateRequest.name_must_not_be_whitespace_only lines=28-63

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/project_create_request.py
   :language: python
   :lines: 28-63
   :lineno-match:

.. CG-EXPLANATION-START id=method:ProjectCreateRequest.name_must_not_be_whitespace_only

**What this does.** An extra check on the name: it rejects a name made entirely of spaces, even though the length rule alone would let a single space through.

**Why it is here.** The length rule counts a single space as one valid character, so this closes the gap — a project must be human-identifiable, and a whitespace-only name is rejected with a ``422``. A *field validator* is a small function Pydantic runs on one field's value during validation.

.. CG-EXPLANATION-END id=method:ProjectCreateRequest.name_must_not_be_whitespace_only

