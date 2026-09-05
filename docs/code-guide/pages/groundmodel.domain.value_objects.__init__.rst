groundmodel.domain.value_objects
================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/__init__.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/__init__.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-1

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/__init__.py
   :language: python
   :lines: 1-1
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** One docstring line — 'Immutable domain value objects' — and no code.

**Why it is here.** It marks the ``value_objects`` package. A *value object* is a small data holder that is identified by *what it holds*, not by an id — two depths of 3.0 m are simply the same depth. *Immutable* means it cannot be changed after it is made. These shapes carry no identity and no behaviour beyond a little self-checking, which is exactly why they are safe to pass around the pure domain layer.

.. CG-EXPLANATION-END id=module-header

