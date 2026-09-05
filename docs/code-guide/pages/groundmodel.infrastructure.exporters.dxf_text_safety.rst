groundmodel.infrastructure.exporters.dxf_text_safety
====================================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/dxf_text_safety.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/dxf_text_safety.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_text_safety.py
   :language: python
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's one-line job: strip carriage-returns and line-feeds from any string bound for a DXF file. It imports nothing beyond the future-annotations switch.

**Why it is here.** A DXF (the CAD drawing-exchange text file) is *line-oriented* — a numeric group code sits on one line and its value on the next — so a stray line break inside a string value splits the record and corrupts the file. The DXF-writing library ezdxf guards this only with an ``assert``, which the optimised ``python -O`` build strips out, so a packaged build could emit a corrupt DXF and never notice. Removing the breaks ourselves means the protection never depends on assertions being switched on.

.. CG-EXPLANATION-END id=module-header

Function ``def strip_dxf_line_breaks``
--------------------------------------

.. CG-BLOCK id=function:strip_dxf_line_breaks lines=16-31

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/dxf_text_safety.py
   :language: python
   :lines: 16-31
   :lineno-match:

.. CG-EXPLANATION-START id=function:strip_dxf_line_breaks

**What this does.** Returns the text with every carriage-return and line-feed deleted.

**Why it is here.** It is byte-for-byte identical for any string that has no line break, so it changes nothing on the overwhelming majority of real formation and investigation names; it only bites the rare bad-import name that carried a raw newline.

.. CG-EXPLANATION-END id=function:strip_dxf_line_breaks

