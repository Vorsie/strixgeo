groundmodel.application.auto_populate_outcome
=============================================

.. CG-PAGE source=src/groundmodel/application/auto_populate_outcome.py complete=true

*Source file:* ``src/groundmodel/application/auto_populate_outcome.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../src/groundmodel/application/auto_populate_outcome.py
   :language: python
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line module docstring plus the imports for the value object defined below.

**Why it is here.** The project convention is one class per file; this file holds only the auto-populate outcome type, so its header is deliberately tiny.

.. CG-EXPLANATION-END id=module-header

Class ``AutoPopulateOutcome``
-----------------------------

.. CG-BLOCK id=class:AutoPopulateOutcome lines=13-94

.. literalinclude:: ../../../src/groundmodel/application/auto_populate_outcome.py
   :language: python
   :lines: 13-94
   :lineno-match:

.. CG-EXPLANATION-START id=class:AutoPopulateOutcome

**What this does.** A frozen *dataclass* — a small immutable holder of named values (frozen means once made its fields cannot be changed) — summarising one auto-populate run. It carries the ids of the contacts and formations that were created, the ids and display names of any formations deleted, five skip counts (already-existing, empty-description, no-stratigraphy, not-in-model, and key-filtered), the list of lumping collisions, the ids of contacts that already existed and were re-used, and the mode the run actually executed under. Several fields carry a default so older call sites stay valid.

**Why it is here.** Nearly every field exists so a silent surprise cannot reach the engineer. The deleted-formation NAMES ride alongside the ids because a toast that lists ids answers nothing when the engineer asks "where did my units go?". The ``found_contact_ids`` let the Seed router union pre-existing contacts into the section's seeded set, so a contact from an earlier Fill is also seeded, not only the ones this run created. The ``mode`` is echoed back so the caller can assert the server honoured the mode it asked for, rather than inferring it from an empty deletion list — which is also what a no-op overwrite looks like. The defaults (especially ``mode`` defaulting to the safe add mode) follow the same rule as the use case: an omission must never imply deletion.

.. CG-EXPLANATION-END id=class:AutoPopulateOutcome

