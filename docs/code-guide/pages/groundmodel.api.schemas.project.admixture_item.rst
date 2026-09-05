groundmodel.api.schemas.project.admixture_item
==============================================

.. CG-PAGE source=src/groundmodel/api/schemas/project/admixture_item.py complete=true

*Source file:* ``src/groundmodel/api/schemas/project/admixture_item.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/admixture_item.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports the shared strict base class that every write-schema inherits from.

**Why it is here.** A *schema* here is a small class that declares the exact fields and types the web layer accepts or returns. Grouping one schema per file keeps each web shape easy to find (project convention: one class per file).

.. CG-EXPLANATION-END id=module-header

Class ``AdmixtureItem``
-----------------------

.. CG-BLOCK id=class:AdmixtureItem lines=8-35

.. literalinclude:: ../../../src/groundmodel/api/schemas/project/admixture_item.py
   :language: python
   :lines: 8-35
   :lineno-match:

.. CG-EXPLANATION-START id=class:AdmixtureItem

**What this does.** Declares the shape of a secondary soil component (an admixture) as it crosses the web boundary: a soil code, an optional amount token, and a flag for whether it appears only locally. Each line names one *field* and its *type* — text, or a true/false flag with a default.

**Why it is here.** This is the single API-boundary mirror of the domain's ``Admixture`` value; keeping the web shape separate from the internal one lets storage change without breaking the web contract. The docstring records that two request families used to carry near-identical private copies of this shape, so it was unified into one superset with defaults, keeping the wire field names unchanged (the project's don't-repeat rule). The soil code and amount are RAW DOV vocabulary tokens (Dutch abbreviations), stored and returned untranslated — translation to English happens in the desktop UI, per the translate-at-the-presentation-boundary rule.

.. CG-EXPLANATION-END id=class:AdmixtureItem

