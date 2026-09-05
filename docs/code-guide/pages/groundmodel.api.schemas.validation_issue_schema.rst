groundmodel.api.schemas.validation_issue_schema
===============================================

.. CG-PAGE source=src/groundmodel/api/schemas/validation_issue_schema.py complete=true

*Source file:* ``src/groundmodel/api/schemas/validation_issue_schema.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../src/groundmodel/api/schemas/validation_issue_schema.py
   :language: python
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** One line of documentation, then the import of Pydantic's base model.

**Why it is here.** Names the file: the wire shape of a single parse finding, shared by more than one router.

.. CG-EXPLANATION-END id=module-header

Class ``ValidationIssueSchema``
-------------------------------

.. CG-BLOCK id=class:ValidationIssueSchema lines=6-12

.. literalinclude:: ../../../src/groundmodel/api/schemas/validation_issue_schema.py
   :language: python
   :lines: 6-12
   :lineno-match:

.. CG-EXPLANATION-START id=class:ValidationIssueSchema

**What this does.** A four-field schema for one finding raised while parsing a file: a severity level (error, warning, or info), a short machine code, a human message, and the list of row numbers it concerns.

**Why it is here.** It is the API-boundary form of the parser's internal finding, so the desktop can show the engineer exactly what was wrong with an imported file and where. Keeping it a plain response schema (not a strict request model) is right because the server produces it, never receives it.

.. CG-EXPLANATION-END id=class:ValidationIssueSchema

