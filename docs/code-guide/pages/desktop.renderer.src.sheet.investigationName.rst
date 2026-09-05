desktop.renderer.src.sheet.investigationName
============================================

.. CG-PAGE source=desktop/src/renderer/src/sheet/investigationName.ts complete=false

*Source file:* ``desktop/src/renderer/src/sheet/investigationName.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/investigationName.ts
   :language: typescript
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A documentation comment explaining how a short code and a project key are pulled out of an investigation's full name. It notes that DOV names are shaped ``<order>-<code>`` (for example ``GEO-16/095-S7``), that the order part is what the owner calls ``the geo identifier`` and is used as the colour key on the map, and that a name with no dash has no project and is its own code.

**Why it is here.** The spec (``Codes, colours, legend``) asks for short labels like ``S7`` and ``B4`` on the map and a legend grouped by project. This comment records the naming rule the code below follows, taken from how DOV names its investigations, so the reasoning lives next to the code.

.. CG-EXPLANATION-END id=module-header

``interface SplitName``
-----------------------

.. CG-BLOCK id=interface:SplitName lines=7-11

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/investigationName.ts
   :language: typescript
   :lines: 7-11
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SplitName

**What this does.** Declares the shape of the result: a ``projectKey`` (the order / geo identifier) and a ``code`` (the short label), both plain text.

**Why it is here.** An *interface* is a named description of the fields a value must carry. Naming this shape makes it clear that splitting a name always yields exactly these two pieces, so callers know what they get back.

.. CG-EXPLANATION-END id=interface:SplitName

``function splitInvestigationName``
-----------------------------------

.. CG-BLOCK id=function:splitInvestigationName lines=12-26

.. literalinclude:: ../../../desktop/src/renderer/src/sheet/investigationName.ts
   :language: typescript
   :lines: 12-26
   :lineno-match:

.. CG-EXPLANATION-START id=function:splitInvestigationName

**What this does.** Splits a name into its project key and short code. It trims the name and cuts it on dashes. A name with no dash has no project and is its own code. Otherwise the last piece is the code and the pieces before it are the project key — with one special case: if the last piece is a bare number and the piece before it is a single letter (as in ``B-4``), the letter is joined to the number so the code becomes ``B4``. An empty code falls back to the project key or the whole name.

**Why it is here.** This produces exactly the four cases the spec lists: ``GEO-16/095-S7`` gives ``S7``, ``GEO-16/095-B4`` gives ``B4``, ``B-4`` gives ``B4``, and ``Sondering 12`` (no dash) is its own code. Codes are deliberately not forced to be unique — colour disambiguates them on the map — so the rule can stay this simple. These are the exact cases pinned by the unit tests for this file.

.. CG-EXPLANATION-END id=function:splitInvestigationName

