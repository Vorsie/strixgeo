groundmodel.application.import_cpt_dov_result
=============================================

.. CG-PAGE source=src/groundmodel/application/import_cpt_dov_result.py complete=true

*Source file:* ``src/groundmodel/application/import_cpt_dov_result.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../src/groundmodel/application/import_cpt_dov_result.py
   :language: python
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the dataclass helpers for the DOV-CPT result below.

**Why it is here.** A tiny module so the result shape lives on its own.

.. CG-EXPLANATION-END id=module-header

Class ``ImportCptDovResult``
----------------------------

.. CG-BLOCK id=class:ImportCptDovResult lines=7-26

.. literalinclude:: ../../../src/groundmodel/application/import_cpt_dov_result.py
   :language: python
   :lines: 7-26
   :lineno-match:

.. CG-EXPLANATION-START id=class:ImportCptDovResult

**What this does.** The summary a DOV bbox CPT import returns: how many CPTs were imported, how many were already present, how many failed, and the ids of every CPT the caller now sees (new and pre-existing).

**Why it is here.** The counts let the desktop show one honest ``imported / duplicates / failed`` line, and the id list lets it auto-load both newly imported and already-present CPTs without a second query.

.. CG-EXPLANATION-END id=class:ImportCptDovResult

