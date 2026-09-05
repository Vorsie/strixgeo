groundmodel.api.schemas.project.body.update_body_color_request
==============================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/body/update_body_color_request.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/body/update_body_color_request.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body/update_body_color_request.py
   :language: python
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports (``UUID``, Pydantic ``BaseModel`` and ``Field``, the strict base).

**Why it is here.** A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=module-header

Class ``UpdateBodyColorRequest``
--------------------------------

.. CG-BLOCK id=class:UpdateBodyColorRequest lines=12-30

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body/update_body_color_request.py
   :language: python
   :lines: 12-30
   :lineno-match:

.. CG-EXPLANATION-START id=class:UpdateBodyColorRequest

**What this does.** Carries only ``display_color`` — a hex colour string (max 20 characters) or ``None`` to reset the per-body override.

**Why it is here.** The docstring notes this extends the existing PATCH handler additively without touching the name-update path; resetting to ``None`` falls back to the formation colour in the 3-D viewer. A *request schema* declares and validates what the desktop may send; it inherits ``StrictRequestModel``, which rejects unknown fields and non-finite numbers so a client typo fails loudly with a 422 instead of silently writing junk.

.. CG-EXPLANATION-END id=class:UpdateBodyColorRequest

Class ``UpdateBodyColorResponse``
---------------------------------

.. CG-BLOCK id=class:UpdateBodyColorResponse lines=31-43

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/body/update_body_color_request.py
   :language: python
   :lines: 31-43
   :lineno-match:

.. CG-EXPLANATION-START id=class:UpdateBodyColorResponse

**What this does.** The reply: the updated body id and the persisted colour.

**Why it is here.** A *response schema* is the shape the API returns to the desktop, kept separate from the database row so internal storage can change without breaking the web contract; new fields are additive (default to optional/null) per the API contract in ``docs/api.md``.

.. CG-EXPLANATION-END id=class:UpdateBodyColorResponse

