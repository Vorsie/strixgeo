groundmodel.domain.value_objects.unit_weight_profile
====================================================

.. CG-PAGE source=src/groundmodel/domain/value_objects/unit_weight_profile.py complete=true

*Source file:* ``src/groundmodel/domain/value_objects/unit_weight_profile.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/unit_weight_profile.py
   :language: python
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A module docstring plus one import of ``dataclass``. The docstring marks this as a PREVIEW shape used by the preview Ic calculation, with the production version deferred to Phase 5.

**Why it is here.** It records the CLAUDE.md build-sequence boundary: proper per-layer unit weights, derived from the Robertson soil-behaviour classification, are Phase 5 work; this fixed-defaults shape is only enough to feed the early preview.

.. CG-EXPLANATION-END id=module-header

Class ``UnitWeightProfile``
---------------------------

.. CG-BLOCK id=class:UnitWeightProfile lines=11-33

.. literalinclude:: ../../../src/groundmodel/domain/value_objects/unit_weight_profile.py
   :language: python
   :lines: 11-33
   :lineno-match:

.. CG-EXPLANATION-START id=class:UnitWeightProfile

**What this does.** Defines ``UnitWeightProfile``, a frozen value object holding three bulk unit weights used to estimate vertical stress: ``gamma_unsat`` (above the water table, default 18.0), ``gamma_sat`` (below it, default 20.0), and ``gamma_w`` (water, default 9.81), all in kN/m³.

**Why it is here.** The CPT normalisation that the preview Ic needs an estimate of vertical effective stress, which needs unit weights. The defaults are intentional values for Belgian/Dutch practice, with the docstring noting the honest limitation: unit weight really is soil-type dependent, and the proper next step is to derive it per layer from the soil classification once automatic profiling exists (Phase 5). Until then a project or CPT can override these.

.. CG-EXPLANATION-END id=class:UnitWeightProfile

