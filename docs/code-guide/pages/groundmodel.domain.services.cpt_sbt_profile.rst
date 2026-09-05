groundmodel.domain.services.cpt_sbt_profile
===========================================

.. CG-PAGE source=src/groundmodel/domain/services/cpt_sbt_profile.py complete=true

*Source file:* ``src/groundmodel/domain/services/cpt_sbt_profile.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../src/groundmodel/domain/services/cpt_sbt_profile.py
   :language: python
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a thin driver that classifies one CPT with BOTH soil-behaviour-type methods, per depth point, and imports the two published classifiers plus the water-table resolver and default unit weights. It owns no soil mechanics of its own.

**Why it is here.** The owner ruled (dogfeed 2026-08-03) that a per-CPT plot should show the full normalised Robertson (2009/2015) zone strip — which carries the extended organic/peat boundary of Lengkeek & Brinkgreve (2022) — alongside the non-normalised strip, because showing one alone hides the disagreement, and it is exactly that disagreement, shallow or where the stress profile is unreliable, the engineer needs to see. The normalised pipeline is driven exactly as the litho segmenter drives it and under the same water table and unit weights, so the zones the engineer reads and the ghost boundaries he is offered come from one pipeline. Nothing here is persisted: soil-behaviour type is a characterisation output shown to the engineer, never a committed design value, and it is derived on read carrying the water table it was derived under.

.. CG-EXPLANATION-END id=module-header

Class ``SbtProfile``
--------------------

.. CG-BLOCK id=class:SbtProfile lines=44-83

.. literalinclude:: ../../../src/groundmodel/domain/services/cpt_sbt_profile.py
   :language: python
   :lines: 44-83
   :lineno-match:

.. CG-EXPLANATION-START id=class:SbtProfile

**What this does.** A frozen data holder aligning both classifications on one depth axis: the depths, the normalised index Ic and its chart zone, the non-normalised index and its zone, and the water-table depth and where it came from. Every list is the same length as the depths, and an empty slot marks a depth the classifier could not evaluate.

**Why it is here.** Bundling both columns on one shared depth axis is what lets the renderer draw them side by side for comparison. An empty slot is an honest "could not classify" — missing sleeve friction, or a non-positive net resistance near the surface — never a filled-in guess. The non-normalised zones deliberately omit zones 1, 8 and 9, which cannot be told from the index alone; carrying the water-table provenance keeps the label and the maths from ever disagreeing.

.. CG-EXPLANATION-END id=class:SbtProfile

Function ``def compute_sbt_profile``
------------------------------------

.. CG-BLOCK id=function:compute_sbt_profile lines=84-185

.. literalinclude:: ../../../src/groundmodel/domain/services/cpt_sbt_profile.py
   :language: python
   :lines: 84-185
   :lineno-match:

.. CG-EXPLANATION-START id=function:compute_sbt_profile

**What this does.** Classifies a CPT series with both methods. It first truncates the depth, qc and friction arrays to the shortest of the three. It runs the normalised pipeline — stress profile, then the iterative Qtn/F/Ic convergence, then the zone ladder — and separately the closed-form non-normalised index and its zone per row. It returns both series, both indices, and the water-table provenance.

**Why it is here.** Truncating up front matters because a restored ``.strix`` bundle can carry ragged arrays, and the profile must degrade to "classified the rows we have" rather than crash out of a read; truncating once also keeps every output list parallel to the depths, which is the contract the renderer draws on. The water table is passed in already resolved, not resolved here, so the caller cannot end up with a profile whose label and whose maths disagree. The unit weights must match the litho segmenter's, or the strip and the ghost boundaries would normalise against different effective stresses. The stress trick — ground at zero elevation, water at minus the water depth — lets the maths need only the depth to water, which DOV-imported CPTs carry but a surveyed collar they often lack.

.. CG-EXPLANATION-END id=function:compute_sbt_profile

