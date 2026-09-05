groundmodel.shared.constants
============================

.. CG-PAGE source=src/groundmodel/shared/constants/__init__.py complete=true

*Source file:* ``src/groundmodel/shared/constants/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../src/groundmodel/shared/constants/__init__.py
   :language: python
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description for the ``shared/constants`` package. It explains that pure constant, enum and codelist modules used by more than one layer live here. A *constant* is a fixed named value, an *enum* is a fixed set of named allowed values, and a *codelist* is a lookup table mapping raw codes to their meaning.

**Why it is here.** The layer rule (CLAUDE.md "Architecture": API → Application → Domain ← Infrastructure) forbids the API layer importing from the domain layer. A constant both ends need must sit at a shared floor both may import, and ``shared/`` is the explicitly cross-layer-permitted home for it (debt #54).

.. CG-EXPLANATION-END id=module-header

