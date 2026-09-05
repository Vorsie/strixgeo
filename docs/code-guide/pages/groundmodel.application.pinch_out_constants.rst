groundmodel.application.pinch_out_constants
===========================================

.. CG-PAGE source=src/groundmodel/application/pinch_out_constants.py complete=true

*Source file:* ``src/groundmodel/application/pinch_out_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../src/groundmodel/application/pinch_out_constants.py
   :language: python
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Defines two constants for synthetic pinch-out contacts: the source token and a low confidence.

**Why it is here.** Constants live in a dedicated file beside the use case that uses them (a CLAUDE.md convention). The confidence is low because a synthetic tip position is model-derived, not measured, so the engineer should verify it against site data before trusting it in a design (the characterisation-not-design boundary).

.. CG-EXPLANATION-END id=module-header

