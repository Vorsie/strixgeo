groundmodel.domain.services.gwt_resolution
==========================================

.. CG-PAGE source=src/groundmodel/domain/services/gwt_resolution.py complete=true

*Source file:* ``src/groundmodel/domain/services/gwt_resolution.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../src/groundmodel/domain/services/gwt_resolution.py
   :language: python
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the single resolver for "which water table did this derived value use?", imports the project-wide default water depth and the stored water-source enum, and defines the three provenance labels a screen may show: recorded, engineer, assumed.

**Why it is here.** Every Robertson consumer normalises against effective stress, which needs a groundwater depth, and three of them need it — the Ic curve, the litho segmenter's ghost boundaries, and the soil-behaviour profile. If any two resolved it differently, the engineer would validate boundaries against a curve built on a different water table than the one that proposed them, and neither screen would say so. So the fallback lives here once, and the resolver also reports where the number came from (Data Integrity Rule 1: a derived value must be able to say what it was derived from). The labels are deliberately not the stored enum — "assumed" has no stored value, and "gef" is an implementation detail the engineer reads simply as "recorded".

.. CG-EXPLANATION-END id=module-header

Class ``ResolvedGwt``
---------------------

.. CG-BLOCK id=class:ResolvedGwt lines=33-50

.. literalinclude:: ../../../src/groundmodel/domain/services/gwt_resolution.py
   :language: python
   :lines: 33-50
   :lineno-match:

.. CG-EXPLANATION-START id=class:ResolvedGwt

**What this does.** A frozen data holder for the water depth a derivation used and where it came from: the depth below ground surface, and a label of recorded, engineer, or assumed.

**Why it is here.** It carries the number and its provenance together so a screen can never show a derived value without being able to say what it rests on. The three labels distinguish a value parsed from the file, one the engineer typed (which outranks the file), and the project-wide assumed default used when nothing is recorded.

.. CG-EXPLANATION-END id=class:ResolvedGwt

Function ``def resolve_gwt``
----------------------------

.. CG-BLOCK id=function:resolve_gwt lines=51-82

.. literalinclude:: ../../../src/groundmodel/domain/services/gwt_resolution.py
   :language: python
   :lines: 51-82
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolve_gwt

**What this does.** Resolves a CPT's groundwater depth and its provenance. With no recorded depth it returns the one project-wide assumed default labelled assumed. With a depth stamped by the engineer it returns that labelled engineer. Any other depth is treated as file-derived and labelled recorded.

**Why it is here.** This is the one place the fallback and the provenance are decided, so every consumer agrees. Every DOV-imported CPT has no recorded water table and lands on the assumed default, which the label makes honest. A legacy row with a depth but no source token can only have come from the parser, so it is read as recorded rather than guessed.

.. CG-EXPLANATION-END id=function:resolve_gwt

