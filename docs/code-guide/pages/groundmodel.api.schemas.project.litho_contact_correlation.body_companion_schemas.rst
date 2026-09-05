groundmodel.api.schemas.project.litho_contact_correlation.body_companion_schemas
================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/litho_contact_correlation/body_companion_schemas.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/litho_contact_correlation/body_companion_schemas.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_contact_correlation/body_companion_schemas.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring, then an import of ``BaseModel``.

**Why it is here.** A single response schema; same pattern.

.. CG-EXPLANATION-END id=module-header

Class ``MaterialiseBodyCompanionsResponse``
-------------------------------------------

.. CG-BLOCK id=class:MaterialiseBodyCompanionsResponse lines=8-30

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/litho_contact_correlation/body_companion_schemas.py
   :language: python
   :lines: 8-30
   :lineno-match:

.. CG-EXPLANATION-START id=class:MaterialiseBodyCompanionsResponse

**What this does.** The result of the body-companions materialise endpoint: how many perpendicular companion sections were created, and counts of bodies skipped for a missing primary section or an unfinished one, plus bodies that errored.

**Why it is here.** The docstring records that the loop continues past each error, so a non-zero error count warrants investigation but does not block the other bodies — one bad body cannot spoil the rest.

.. CG-EXPLANATION-END id=class:MaterialiseBodyCompanionsResponse

