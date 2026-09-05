groundmodel.api.schemas.project.formation_contact.contact_enums
===============================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/formation_contact/contact_enums.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/formation_contact/contact_enums.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/formation_contact/contact_enums.py
   :language: python
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Two closed *Literal* type aliases: ``ContactSource`` (the fixed set of allowed contact sources — borehole observation, manual pick, interpolated, geological-model seed, and pinch-out extrapolation) and ``ContactConfidence`` (high, medium, low).

**Why it is here.** These are type aliases, not classes, kept together so adding a source is one edit — the docstring records that the one-class-per-file rule governs classes, not aliases. Pydantic enforces the allowed strings literally while the database column stays plain text, so a new source is a Pydantic-only change. The comments explain each source, including why the synthetic pinch-out source is ranked below the real-data sources in de-duplication so it never evicts a real pick.

.. CG-EXPLANATION-END id=module-header

