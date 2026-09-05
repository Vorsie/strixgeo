groundmodel.api.schemas.project.geotech_band_edit.geotech_band_edit_plan_response
=================================================================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/geotech_band_edit/geotech_band_edit_plan_response.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/geotech_band_edit/geotech_band_edit_plan_response.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/geotech_band_edit_plan_response.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring naming the schema, then imports: ``BaseModel`` and ``Field`` (the Pydantic tools for declaring a data shape), and the two item schemas this one embeds — the interval item and the warning item.

**Why it is here.** A *Pydantic schema* is a declared shape for the JSON that crosses the web boundary; *JSON* is the plain-text format the desktop and the engine exchange data in. Declaring the shape lets the framework check incoming data and describe outgoing data automatically. This file's schema is built from two smaller schemas, imported here.

.. CG-EXPLANATION-END id=module-header

Class ``GeotechBandEditPlanResponse``
-------------------------------------

.. CG-BLOCK id=class:GeotechBandEditPlanResponse lines=15-50

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/geotech_band_edit/geotech_band_edit_plan_response.py
   :language: python
   :lines: 15-50
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechBandEditPlanResponse

**What this does.** Declares the *response* shape returned when the engineer asks "what would this split or merge do?" — the preview. Each line inside is a *field*: a named value with a *type* (``str`` text, ``float`` a decimal number, or a ``list`` of item schemas). ``Field(...)`` attaches a description and, where the three dots ``...`` appear, marks the field as required; a value like ``"median"`` or ``default_factory=list`` gives a default when the field is omitted. The fields are: the kind of edit ("split" or "merge"), the statistic the numbers were computed with, the top and base of the enclosing litho body, the resulting intervals, and any advisory warnings.

**Why it is here.** A *response schema* is the shape sent back to the desktop, kept separate from the internal database row so storage can change without breaking the web contract. Fields are additive-only: a new one defaults to optional so an older client keeps working. The docstring records that the preview never blocks — a non-empty warnings list is advisory, because a manual override always wins — and that the statistic is carried so the consequence sheet can label its cone-resistance figures honestly (owner ruling 7).

.. CG-EXPLANATION-END id=class:GeotechBandEditPlanResponse

