groundmodel.infrastructure.parsers.cpt.validation.validation_issue
==================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/cpt/validation/validation_issue.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/cpt/validation/validation_issue.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/validation/validation_issue.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line description, then imports of ``dataclass`` and ``field`` (Python helpers for building a plain data-holder class) and the severity enum from the previous file.

**Why it is here.** A *dataclass* is a class whose only job is to hold a few named values together; writing ``@dataclass`` above it makes Python fill in the boilerplate. The next block uses it to describe a single validation finding.

.. CG-EXPLANATION-END id=module-header

Class ``ValidationIssue``
-------------------------

.. CG-BLOCK id=class:ValidationIssue lines=8-22

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/validation/validation_issue.py
   :language: python
   :lines: 8-22
   :lineno-match:

.. CG-EXPLANATION-START id=class:ValidationIssue

**What this does.** Describes one validation finding as four fields: its ``level`` (error / warning / info), a short machine ``code`` (for example ``UNCORRECTED_DEPTH``), a plain-English ``message``, and an optional list of the row numbers it concerns. The row list starts empty when a finding is about the file as a whole rather than particular rows.

**Why it is here.** This is the single shape every parser uses to report a problem. The short ``code`` is stable enough for the screen to switch on; the ``message`` is written to be shown to the engineer as-is. Bundling them together means a parser can hand back a plain list of these instead of throwing an exception and stopping — which matters because real-world files are often a little messy and the rest of the pipeline still has to run (see rule 5 in ``docs/data-integrity.md``).

.. CG-EXPLANATION-END id=class:ValidationIssue

Function ``def make_issue``
---------------------------

.. CG-BLOCK id=function:make_issue lines=23-33

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/validation/validation_issue.py
   :language: python
   :lines: 23-33
   :lineno-match:

.. CG-EXPLANATION-START id=function:make_issue

**What this does.** A tiny helper that builds a ``ValidationIssue`` with no row numbers, from just a level, a code, and a message.

**Why it is here.** The four DOV parsers (CPT, borehole, interpretation, grain-size) each used to define this identical helper privately. It is pulled into one place so there is a single copy, per the project rule against duplicating even one-line helpers; each parser imports it under its old private name so its call sites did not change.

.. CG-EXPLANATION-END id=function:make_issue

Function ``def issues_have_errors``
-----------------------------------

.. CG-BLOCK id=function:issues_have_errors lines=34-44

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/validation/validation_issue.py
   :language: python
   :lines: 34-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:issues_have_errors

**What this does.** Answers one yes/no question about a list of findings: does any of them have ``ERROR`` severity?

**Why it is here.** Every result type needs the same "did this file fail?" test, and failure means "at least one error". Defining that meaning once means a future change — say, adding a ``CRITICAL`` level above ``ERROR`` — is a one-line edit here rather than a hunt through every result class.

.. CG-EXPLANATION-END id=function:issues_have_errors

Function ``def issue_warnings``
-------------------------------

.. CG-BLOCK id=function:issue_warnings lines=45-47

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/validation/validation_issue.py
   :language: python
   :lines: 45-47
   :lineno-match:

.. CG-EXPLANATION-START id=function:issue_warnings

**What this does.** Returns just the WARNING-level findings from a list, keeping their original order.

**Why it is here.** The screen shows warnings and errors differently, so every result type needs to pick out the warnings — one shared filter instead of the same loop copied into each.

.. CG-EXPLANATION-END id=function:issue_warnings

