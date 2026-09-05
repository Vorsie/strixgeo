groundmodel.domain.services.borehole_packing_fill
=================================================

.. CG-PAGE source=src/groundmodel/domain/services/borehole_packing_fill.py complete=true

*Source file:* ``src/groundmodel/domain/services/borehole_packing_fill.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-36

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_packing_fill.py
   :language: python
   :lines: 1-36
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a small helper that works out the NAD packing bands for one litho-body extent on a borehole, and imports the ``dataclass`` decorator (a line starting with ``@`` that turns the class below it into a plain holder of named values). The docstring lays out the two steps: clip the CPT-derived packing intervals to the extent, then fill any leftover depth conservatively.

**Why it is here.** A borehole reads no packing of its own, so the CPT intervals borrowed for it must be cut to the borehole's extent, never rescaled — a boundary at 7.5 m on a CPT stays at 7.5 m and is simply cut at the extent edge. Where the CPTs leave a gap, the fill must be conservative: the weakest packing class the body's same-lithology CPTs measured, or the lithology's absolute weakest class when there is no CPT data at all. The docstring ties each provenance tag to the confidence written on the stored layer, so an interpolated band reads ``high`` and a fallback reads ``low`` — the badge must always say how much the value rests on.

.. CG-EXPLANATION-END id=module-header

Class ``FillBand``
------------------

.. CG-BLOCK id=class:FillBand lines=37-59

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_packing_fill.py
   :language: python
   :lines: 37-59
   :lineno-match:

.. CG-EXPLANATION-START id=class:FillBand

**What this does.** A frozen data holder for one packing band inside a borehole's extent: its top and base depth (metres, positive down), its NAD packing class 1–31, and a provenance tag saying where the class came from. "Frozen" means it cannot be changed after it is made.

**Why it is here.** The result is a list of these bands, and the provenance tag is load-bearing: it distinguishes a band read from real CPT data (``cpt_interpolated``) from a conservative fallback (``body_min`` or ``absolute_min``), which is exactly what drives the confidence badge the engineer sees.

.. CG-EXPLANATION-END id=class:FillBand

Function ``def fill_borehole_litho_body_extent``
------------------------------------------------

.. CG-BLOCK id=function:fill_borehole_litho_body_extent lines=60-145

.. literalinclude:: ../../../src/groundmodel/domain/services/borehole_packing_fill.py
   :language: python
   :lines: 60-145
   :lineno-match:

.. CG-EXPLANATION-START id=function:fill_borehole_litho_body_extent

**What this does.** Fills one litho-body extent on a borehole with a contiguous run of packing bands. With no CPT intervals it returns one conservative band covering the whole extent. Otherwise it clips each CPT interval to the extent, drops any that fall fully outside, sorts them top to bottom, and walks down filling every gap — before, between, and after the CPT intervals — with a single conservative band. The returned bands exactly cover the extent with no gaps or overlaps and are never empty.

**Why it is here.** This is the conservative fill rule made concrete. The gap class is the weakest observed across the body when any same-lithology CPT data exists, and only the lithology floor when none does — the weakest packing is the most conservative choice for ground no cone read. Clipping rather than rescaling honours the rule that a CPT boundary keeps its real depth; the tiny tolerances absorb float slack so a hairline gap does not surface as a band that reads as a packing change that never happened.

.. CG-EXPLANATION-END id=function:fill_borehole_litho_body_extent

