groundmodel.infrastructure.parsers.cpt.dov.dov_parse_worker
===========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/cpt/dov/dov_parse_worker.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/cpt/dov/dov_parse_worker.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-42

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_parse_worker.py
   :language: python
   :lines: 1-42
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Explains, in a long docstring, a small helper that runs the CPT XML parse in a *separate process* (a second copy of Python running alongside the main one), and imports the gzip compressor and the result type.

**Why it is here.** Parsing XML is CPU work, and while one CPT is being parsed the main program cannot start downloading the next. Handing the parse to a separate process keeps the main program free to keep downloading. The docstring records two design points: the function must sit at the top level of the file (only such functions can be shipped to another process on Windows), and the XML is gzip-compressed first (squeezed down to about a tenth of its size) because passing the smaller payload between processes is much cheaper.

.. CG-EXPLANATION-END id=module-header

Function ``def parse_cpt_xml``
------------------------------

.. CG-BLOCK id=function:parse_cpt_xml lines=43-89

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_parse_worker.py
   :language: python
   :lines: 43-89
   :lineno-match:

.. CG-EXPLANATION-START id=function:parse_cpt_xml

**What this does.** The function the separate process actually runs: it unzips the compressed XML bytes it was handed and parses them into a result, tagging log lines with the CPT's name.

**Why it is here.** The heavy parser is imported inside the function, not at the top of the file, so the separate process only loads the big libraries when it truly has work to do. The comment records a deliberate deviation from the original design: it returns the full parse result rather than a stripped-down primitive, because that transfers cleanly between processes today and keeps the code correct — with a note to revisit if imports of hundreds of deep CPTs ever become the common case.

.. CG-EXPLANATION-END id=function:parse_cpt_xml

