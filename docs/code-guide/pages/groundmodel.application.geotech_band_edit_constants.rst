groundmodel.application.geotech_band_edit_constants
===================================================

.. CG-PAGE source=src/groundmodel/application/geotech_band_edit_constants.py complete=true

*Source file:* ``src/groundmodel/application/geotech_band_edit_constants.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../src/groundmodel/application/geotech_band_edit_constants.py
   :language: python
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Defines one shared text token, ``"manual"``, which is the
``source`` stamp that every by-hand edit of a packing band writes onto the layer
row.

**Why it is here.** The comment explains the token is WRITTEN by the hand-edit
verbs (set-class, split, merge, move-boundary and move-restated-contact) and READ
by "divide boreholes" to know which borehole columns the engineer has already
reviewed, so a re-divide skips them instead of throwing that work away (owner
ruling 2026-08-23: the machine only decides how the boreholes are divided *until*
the engineer has reviewed them). It is a named constant rather than a literal
repeated at each site because a writer and that reader drifting apart would fail
silently and destructively — the divide would stop recognising a hand-edited
column and re-plan over it. It is one of the four tokens the layer table's CHECK
constraint (a database rule that rejects any row whose value is outside an allowed
set) accepts.

.. CG-EXPLANATION-END id=module-header

