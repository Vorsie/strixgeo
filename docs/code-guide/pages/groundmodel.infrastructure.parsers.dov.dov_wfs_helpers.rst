groundmodel.infrastructure.parsers.dov.dov_wfs_helpers
======================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/dov/dov_wfs_helpers.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/dov/dov_wfs_helpers.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_helpers.py
   :language: python
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring for a set of helpers that clean up the raw property values a WFS reply carries, plus the imports they need.

**Why it is here.** A WFS reply describes each feature as a bag of properties whose values arrive as whatever the reply chose — a real number, a number written as text, or nothing. These helpers turn those into clean typed values, always returning "nothing" when the source is absent or unreadable. They are kept apart from the constants file and the XML helpers so each file has one job.

.. CG-EXPLANATION-END id=module-header

Function ``def last_path_segment``
----------------------------------

.. CG-BLOCK id=function:last_path_segment lines=31-43

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_helpers.py
   :language: python
   :lines: 31-43
   :lineno-match:

.. CG-EXPLANATION-START id=function:last_path_segment

**What this does.** Returns the final segment of a URL's path — for example, the permkey at the end of a DOV record URL.

**Why it is here.** DOV's permanent identifier for a record sits at the tail of several kinds of URL, and this pulls it out reliably even when the URL has a trailing slash, a query string, or a fragment.

.. CG-EXPLANATION-END id=function:last_path_segment

Function ``def optional_float``
-------------------------------

.. CG-BLOCK id=function:optional_float lines=44-58

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_helpers.py
   :language: python
   :lines: 44-58
   :lineno-match:

.. CG-EXPLANATION-START id=function:optional_float

**What this does.** Turns a value into a number, or "nothing" when it is missing or not numeric.

**Why it is here.** WFS property values can be a number, a number-looking string, or nothing at all; this smooths all of those into a clean number-or-nothing so callers do not each have to guard against the odd cases.

.. CG-EXPLANATION-END id=function:optional_float

Function ``def optional_int``
-----------------------------

.. CG-BLOCK id=function:optional_int lines=59-68

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_helpers.py
   :language: python
   :lines: 59-68
   :lineno-match:

.. CG-EXPLANATION-START id=function:optional_int

**What this does.** The same idea as the float helper, but for whole numbers.

**Why it is here.** So a whole-number property is read the same forgiving way as a decimal one.

.. CG-EXPLANATION-END id=function:optional_int

Function ``def optional_date``
------------------------------

.. CG-BLOCK id=function:optional_date lines=69-80

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/dov/dov_wfs_helpers.py
   :language: python
   :lines: 69-80
   :lineno-match:

.. CG-EXPLANATION-START id=function:optional_date

**What this does.** Turns a value into a date, or "nothing" when it is missing, empty, or unreadable.

**Why it is here.** DOV sometimes ships an empty string for an optional date, and treating that as "nothing" keeps a meaningless blank from travelling downstream as if it were a value.

.. CG-EXPLANATION-END id=function:optional_date

