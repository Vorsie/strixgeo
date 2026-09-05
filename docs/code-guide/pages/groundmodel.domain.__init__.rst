groundmodel.domain
==================

.. CG-PAGE source=src/groundmodel/domain/__init__.py complete=true

*Source file:* ``src/groundmodel/domain/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-1

.. literalinclude:: ../../../src/groundmodel/domain/__init__.py
   :language: python
   :lines: 1-1
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The description for the ``domain`` package — the layer that holds the pure geotechnical knowledge (the Robertson soil classification, the NAD packing-class lookup, the layer segmenter). It marks the folder as an importable package and holds no code.

**Why it is here.** The domain layer is deliberately free of any database or web-framework code, so its package marker stays empty. See CLAUDE.md "Architecture": the dependency arrow points into the domain, never out of it, so the valuable, hard-to-get-right knowledge cannot be dragged down by a change to the database or the web framework.

.. CG-EXPLANATION-END id=module-header

