groundmodel.domain.services.body_geo_label
==========================================

.. CG-PAGE source=src/groundmodel/domain/services/body_geo_label.py complete=true

*Source file:* ``src/groundmodel/domain/services/body_geo_label.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../src/groundmodel/domain/services/body_geo_label.py
   :language: python
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the helper that gives a litho body its geological-formation label by thickness-weighted majority, and imports the counting and id tools.

**Why it is here.** The docstring records owner directive A2 of 2026-06-04: a litho body is geologically agnostic and may cross geological-formation boundaries, so its geological name is a DERIVED label, not an identity constraint. It is the formation that owns the greatest share of the body's member thickness, recomputed fresh every read so it stays correct when bodies merge or split or the geological surfaces are edited. The module is pure; the caller loads the data.

.. CG-EXPLANATION-END id=module-header

Function ``def geo_formation_at_depth``
---------------------------------------

.. CG-BLOCK id=function:geo_formation_at_depth lines=21-52

.. literalinclude:: ../../../src/groundmodel/domain/services/body_geo_label.py
   :language: python
   :lines: 21-52
   :lineno-match:

.. CG-EXPLANATION-START id=function:geo_formation_at_depth

**What this does.** Given one investigation's geological contacts sorted by depth, returns the formation whose interval contains a given depth. Since a contact marks the TOP of a formation, the answer is the formation with the deepest top still at or above the query depth. It returns nothing above the shallowest contact.

**Why it is here.** Attributing a member layer to a geological formation means asking which formation owns a particular depth on that column. This is that lookup, and it returns nothing when the depth sits above any defined formation rather than guessing.

.. CG-EXPLANATION-END id=function:geo_formation_at_depth

Function ``def _accrue_members``
--------------------------------

.. CG-BLOCK id=function:_accrue_members lines=53-94

.. literalinclude:: ../../../src/groundmodel/domain/services/body_geo_label.py
   :language: python
   :lines: 53-94
   :lineno-match:

.. CG-EXPLANATION-START id=function:_accrue_members

**What this does.** The shared accrual pass. For each member layer it finds the geological formation owning the layer's midpoint depth, adds the layer's thickness to that formation's running total, and records the shallowest member top attributed to it. A member whose midpoint falls in no formation contributes nothing. It returns two lookups keyed by formation.

**Why it is here.** Both public derivations, the single majority label and the full list of formations present, need the same midpoint attribution and the same two running totals. Extracting it once keeps them consistent: they differ only in how they reduce the two totals. Using the midpoint is a simple, stable way to place a member that straddles a boundary.

.. CG-EXPLANATION-END id=function:_accrue_members

Function ``def majority_geo_formation``
---------------------------------------

.. CG-BLOCK id=function:majority_geo_formation lines=95-126

.. literalinclude:: ../../../src/groundmodel/domain/services/body_geo_label.py
   :language: python
   :lines: 95-126
   :lineno-match:

.. CG-EXPLANATION-START id=function:majority_geo_formation

**What this does.** Runs the accrual pass and returns the single formation with the greatest total member thickness, breaking ties toward the smallest id. It returns nothing when no member falls in any formation.

**Why it is here.** This is the body's one headline geological name: the formation that owns most of its ground. The deterministic tie-break means a rebuild never reshuffles the label at random. It returns nothing when there is no geological model at these columns, rather than inventing a name.

.. CG-EXPLANATION-END id=function:majority_geo_formation

Function ``def geo_formations_present``
---------------------------------------

.. CG-BLOCK id=function:geo_formations_present lines=127-166

.. literalinclude:: ../../../src/groundmodel/domain/services/body_geo_label.py
   :language: python
   :lines: 127-166
   :lineno-match:

.. CG-EXPLANATION-START id=function:geo_formations_present

**What this does.** Runs the same accrual pass and returns EVERY geological formation the body's members fall in, ordered shallowest first, with ties broken by greater thickness then smallest id.

**Why it is here.** The docstring records owner ruling R2 of 2026-08-31: a body crossing two geological formations LISTS them both, so the unit row and the exports carry the full set rather than a single majority stamp. It uses the same midpoint rule as the majority label, so there is no invented inclusion threshold; a formation appears exactly when it owns at least one member's midpoint. The single majority label is unaffected.

.. CG-EXPLANATION-END id=function:geo_formations_present

