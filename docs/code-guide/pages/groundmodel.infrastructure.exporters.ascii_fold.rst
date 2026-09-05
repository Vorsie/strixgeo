groundmodel.infrastructure.exporters.ascii_fold
===============================================

.. CG-PAGE source=src/groundmodel/infrastructure/exporters/ascii_fold.py complete=true

*Source file:* ``src/groundmodel/infrastructure/exporters/ascii_fold.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-59

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/ascii_fold.py
   :language: python
   :lines: 1-59
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's description and its two data tables. It imports Python's Unicode toolkit (``unicodedata``) and defines ``_PUNCTUATION``, a map from the fancy punctuation a word processor slips in (the several kinds of dash, curly single and double quotes, the ellipsis, the degree sign) to plain ASCII, and ``_UNMAPPABLE``, the single ``?`` used for any character that has no ASCII form at all.

**Why it is here.** A ``.shi`` file is written for a Windows program in the cp1252 encoding, but every reader picks its own encoding — GEOLib's own parser opens the file with the machine's locale, so a section named ``A-A'`` written with an en dash broke the parse everywhere UTF-8 is the default (found by CI on Linux, 2026-08-28). Folding free-form labels to plain ASCII makes the file portable. The punctuation is mapped explicitly because Unicode decomposition alone would DELETE a dash, silently losing the separator in ``A-A'`` — a worse result than a plain hyphen.

.. CG-EXPLANATION-END id=module-header

Function ``def ascii_fold``
---------------------------

.. CG-BLOCK id=function:ascii_fold lines=60-79

.. literalinclude:: ../../../src/groundmodel/infrastructure/exporters/ascii_fold.py
   :language: python
   :lines: 60-79
   :lineno-match:

.. CG-EXPLANATION-START id=function:ascii_fold

**What this does.** Rewrites a piece of text so every character is plain ASCII, in three passes: first swap the known fancy punctuation for its ASCII stand-in; then split each accented letter into its base letter plus a separate accent mark and drop the marks; then replace anything still non-ASCII with a ``?``.

**Why it is here.** The result decodes to the same characters under cp1252, latin-1 and UTF-8, so the label survives whichever encoding a reader assumes. Splitting-then-dropping the accent keeps the base letter (``Wetteren-Zuid e``, not ``Wetteren-Zuid``), and it is only ever applied to free-form provenance labels, never to a value a downstream tool parses.

.. CG-EXPLANATION-END id=function:ascii_fold

