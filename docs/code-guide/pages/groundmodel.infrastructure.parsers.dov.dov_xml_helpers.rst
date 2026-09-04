groundmodel.infrastructure.parsers.dov.dov_xml_helpers
======================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/dov/dov_xml_helpers.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/dov/dov_xml_helpers.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_xml_helpers.py
   :language: python
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring explaining a set of small helpers for reading values out of already-parsed XML elements, plus the type-only imports they use.

**Why it is here.** Every DOV parser reads the same-shaped XML in the same way — find a child by tag, take its text, maybe turn it into a number or a date, return "nothing" when it is missing. Pulling that shape into one place keeps each parser focused on its own quirks. The comment is emphatic that this file must never *parse* XML itself — the callers do the parsing with the safety-hardened reader and pass the already-parsed elements in — because the standard XML reader is open to malicious-document attacks this project deliberately avoids.

.. CG-EXPLANATION-END id=module-header

Function ``def text``
---------------------

.. CG-BLOCK id=function:text lines=39-51

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_xml_helpers.py
   :language: python
   :lines: 39-51
   :lineno-match:

.. CG-EXPLANATION-START id=function:text

**What this does.** Returns the trimmed text of a named child element, or an empty string when the element or its text is absent.

**Why it is here.** It returns an empty string rather than "nothing" because most callers immediately combine it with "or nothing" to collapse the empty case — returning "nothing" here would force every caller to handle an extra case. For DOV's text fields, "absent" and "empty" mean the same thing anyway.

.. CG-EXPLANATION-END id=function:text

Function ``def float_value``
----------------------------

.. CG-BLOCK id=function:float_value lines=52-65

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_xml_helpers.py
   :language: python
   :lines: 52-65
   :lineno-match:

.. CG-EXPLANATION-START id=function:float_value

**What this does.** Reads a named child as a number, returning "nothing" when it is missing or not a number.

**Why it is here.** Collapsing both "absent" and "present but unreadable" to the same "nothing" means callers do not have to tell the two apart — a missing measurement and a garbled one are handled the same way.

.. CG-EXPLANATION-END id=function:float_value

Function ``def date_iso``
-------------------------

.. CG-BLOCK id=function:date_iso lines=66-80

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_xml_helpers.py
   :language: python
   :lines: 66-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:date_iso

**What this does.** Reads a named child as a plain ISO date (like ``2002-11-26``), returning "nothing" when it is empty or unreadable.

**Why it is here.** DOV ships dates in that one standard format, so a single small parser covers them all; callers that need stricter checks (say, rejecting a date before 1900) layer that on top.

.. CG-EXPLANATION-END id=function:date_iso

