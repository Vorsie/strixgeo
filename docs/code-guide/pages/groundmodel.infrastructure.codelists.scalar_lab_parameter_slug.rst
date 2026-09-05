groundmodel.infrastructure.codelists.scalar_lab_parameter_slug
==============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/codelists/scalar_lab_parameter_slug.py complete=true

*Source file:* ``src/groundmodel/infrastructure/codelists/scalar_lab_parameter_slug.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-66

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/scalar_lab_parameter_slug.py
   :language: python
   :lines: 1-66
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a curated map from DOV's verbatim lab-parameter strings to short, stable English slugs, and builds the reverse index (slug to the set of raw strings that mean it).

**Why it is here.** The docstring records the design (owner decision 2026-05-18, debt #20): the database stores the raw DOV string, because storing raw upstream tokens and translating only at the boundary is the project rule and Data Integrity Rule 1; but a long, Dutch, changeable string is a poor key for filtering and reporting. A *slug* is a short, fixed, machine-friendly name. This layer computes the slug on read — no new column, no migration — and the reverse index backs a future filter that turns a slug into its raw-string set so the query can match the existing column.

.. CG-EXPLANATION-END id=module-header

Function ``def parameter_slug``
-------------------------------

.. CG-BLOCK id=function:parameter_slug lines=67-86

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/scalar_lab_parameter_slug.py
   :language: python
   :lines: 67-86
   :lineno-match:

.. CG-EXPLANATION-START id=function:parameter_slug

**What this does.** Returns the canonical slug for a verbatim DOV parameter string, or nothing when the string is not yet in the curated map.

**Why it is here.** Nothing is not an error: the catch-all lab family can legitimately store a parameter before its slug is curated, so the caller simply shows the raw string until one is added.

.. CG-EXPLANATION-END id=function:parameter_slug

Function ``def raw_parameters_for_slug``
----------------------------------------

.. CG-BLOCK id=function:raw_parameters_for_slug lines=87-107

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/scalar_lab_parameter_slug.py
   :language: python
   :lines: 87-107
   :lineno-match:

.. CG-EXPLANATION-START id=function:raw_parameters_for_slug

**What this does.** Returns every verbatim DOV string that maps to a given slug (empty when the slug is unknown).

**Why it is here.** This is the load-bearing reverse lookup for the future filtered query: a caller translates a slug to this set and matches the stored column against it, so the slug never has to be stored (the compute-on-read decision behind debt #20).

.. CG-EXPLANATION-END id=function:raw_parameters_for_slug

