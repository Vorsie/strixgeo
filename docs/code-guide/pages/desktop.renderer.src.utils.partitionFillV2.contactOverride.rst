desktop.renderer.src.utils.partitionFillV2.contactOverride
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts
   :language: typescript
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is the free-draw override for the horizontal boundary that an upper band and the lower band directly beneath it BOTH ride. Where ``apexOverride`` shapes a one-sided tip, this shapes the line two full-width bands share: dragging one control point bends that single shared line and re-draws both bands around it.

**Why it is here.** The docstring cites design section 8: the upper band's base line and the lower band's top line ARE the same curve, so bending that one polyline re-traces both faces by construction and the tiling stays gap and overlap free (owner 2026-07-21). The override is keyed by both body ids so it can never collide with a one-sided lens key, and it reuses the same override map because the two-body key namespace cannot alias a single-body key. Pure module.

.. CG-EXPLANATION-END id=module-header

``const CONTACT_ELEV_EPS``
--------------------------

.. CG-BLOCK id=const:CONTACT_ELEV_EPS lines=28-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts
   :language: typescript
   :lines: 28-51
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTACT_ELEV_EPS

**What this does.** A tiny (one-millionth-metre) tolerance for matching two contour elevations before the 1 mm snap.

**Why it is here.** Elevations are compared before snapping, so a hair's-width tolerance decides whether two contours coincide.

.. CG-EXPLANATION-END id=const:CONTACT_ELEV_EPS

``function contactApexOverrideKey``
-----------------------------------

.. CG-BLOCK id=function:contactApexOverrideKey lines=52-88

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts
   :language: typescript
   :lines: 52-88
   :lineno-match:

.. CG-EXPLANATION-START id=function:contactApexOverrideKey

**What this does.** Builds the lookup name for a shared-contact override from the upper body id, the lower body id and the gap, prefixed ``contact:`` so it lives in its own namespace.

**Why it is here.** The docstring explains the ``contact:`` prefix keeps it distinct from the one-sided ``bodyId@gap`` key so the two can share one override map without collision, and the (upper, lower) order matters because the two bands play distinct roles.

.. CG-EXPLANATION-END id=function:contactApexOverrideKey

``function contactApexOverride``
--------------------------------

.. CG-BLOCK id=function:contactApexOverride lines=89-134

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts
   :language: typescript
   :lines: 89-134
   :lineno-match:

.. CG-EXPLANATION-START id=function:contactApexOverride

**What this does.** Looks up a shared-contact override and, if found, returns its control point clamped so the bent boundary stays strictly between the upper band's own top and the lower band's own base, and strictly inside the gap; returns nothing when no override applies.

**Why it is here.** The docstring explains each clamp: the elevation is pinned between the two outer contacts so the divider can never invert into an overlap, and the fraction uses the same 0.02 interior margin ``apexOverride`` uses so a control point on or past a column cannot make the bent segment cross it. A too-thin band pins to the midpoint (a no-op bend).

.. CG-EXPLANATION-END id=function:contactApexOverride

``function bendBandContour``
----------------------------

.. CG-BLOCK id=function:bendBandContour lines=135-180

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts
   :language: typescript
   :lines: 135-180
   :lineno-match:

.. CG-EXPLANATION-START id=function:bendBandContour

**What this does.** Bends a straight two-point band contour through a control point, inserting an apex vertex at the fraction it maps to, and returns the three-point polyline (left, apex, right); if the apex would land on an endpoint it returns the straight two points.

**Why it is here.** The docstring notes the same bent line is emitted for both the upper band's base and the lower band's top, so bending both identically re-traces both faces around one shared coincident edge (the arrangement unions coincident segments). The degenerate guard keeps a zero-length segment out of the arrangement.

.. CG-EXPLANATION-END id=function:bendBandContour

``function bendBandContourConfined``
------------------------------------

.. CG-BLOCK id=function:bendBandContourConfined lines=181-211

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts
   :language: typescript
   :lines: 181-211
   :lineno-match:

.. CG-EXPLANATION-START id=function:bendBandContourConfined

**What this does.** Bends a band contour through a control point but only on ONE side of a fixed wall vertex, holding the other side at its original line. It builds the polyline in the right order, inserting the apex only when it falls on the flush side of the wall.

**Why it is here.** The docstring (section 113) explains this is for the case where an onlap intervenes between the two bands: the wall pins the onlap-side segment to its original line so a rider sampling that side does not move, while the apex bends only the flush segment.

.. CG-EXPLANATION-END id=function:bendBandContourConfined

``function contactElevMatches``
-------------------------------

.. CG-BLOCK id=function:contactElevMatches lines=212-237

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts
   :language: typescript
   :lines: 212-237
   :lineno-match:

.. CG-EXPLANATION-START id=function:contactElevMatches

**What this does.** Reports whether two elevations coincide within the contact-match tolerance.

**Why it is here.** A one-line shared predicate for the coincident-contour test.

.. CG-EXPLANATION-END id=function:contactElevMatches

``interface ContactBend``
-------------------------

.. CG-BLOCK id=interface:ContactBend lines=238-270

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts
   :language: typescript
   :lines: 238-270
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ContactBend

**What this does.** A type describing one shared-contact bend: the per-column elevations of the contour to bend, the control point, and a flag ``heterogeneous`` distinguishing two shapes -- flush (the two bands share one physical contact everywhere) versus heterogeneous (a third body, an onlap, sits between them on some column so the upper band's base does not meet the lower band's top there). In the heterogeneous case it also carries the matrix-top tie's elevations that must hold and, for the confined shape, the wall fraction and elevation.

**Why it is here.** The docstring (sections 112 and 113) explains why the two shapes differ: flush bends the shared tie and its coincident band contour identically; heterogeneous bends only the clay's OWN base line and leaves the matrix-top tie put, attaching the bent clay-base line to that tie's ride-points so an intervening onlap follows it without the matrix moving.

.. CG-EXPLANATION-END id=interface:ContactBend

``const CONTOUR_MATCH_M``
-------------------------

.. CG-BLOCK id=const:CONTOUR_MATCH_M lines=271-273

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts
   :language: typescript
   :lines: 271-273
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTOUR_MATCH_M

**What this does.** A one-millimetre tolerance for matching a contour to a bend by its per-column elevations.

**Why it is here.** The ties and bands are compared before the 1 mm snap, so 1 mm is the natural match grid.

.. CG-EXPLANATION-END id=const:CONTOUR_MATCH_M

``function bodiesBoundingContact``
----------------------------------

.. CG-BLOCK id=function:bodiesBoundingContact lines=274-318

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts
   :language: typescript
   :lines: 274-318
   :lineno-match:

.. CG-EXPLANATION-START id=function:bodiesBoundingContact

**What this does.** Returns every body id whose unit base (or top) sits at a given per-column elevation across both columns.

**Why it is here.** The docstring context explains the engine's unit body id and the rendered body id can differ, so an override keyed on the rendered id is matched against the SET of bodies whose contact sits at the tie elevation, letting whichever id the app sent find its band's real contact.

.. CG-EXPLANATION-END id=function:bodiesBoundingContact

``function collectContactBends``
--------------------------------

.. CG-BLOCK id=function:collectContactBends lines=319-499

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts
   :language: typescript
   :lines: 319-499
   :lineno-match:

.. CG-EXPLANATION-START id=function:collectContactBends

**What this does.** For one gap it reads the shared-contact override keys, and for each active tie whose contact carries such an override it builds a ``ContactBend`` -- deciding flush versus heterogeneous, clamping the control point, and (in the confined heterogeneous case) emitting a companion bend so the matrix top follows the clay base on the flush segment and holds on the onlap segment.

**Why it is here.** This is the routine ``emitCurves`` calls to gather every hand-bent shared contact in a gap; the docstring and inline comments walk the flush, heterogeneous and confined decision in full, each branch tied to the owner's freedraw-onlap reflow spec (sections 112 and 113). It returns empty when no override applies, keeping the no-override path byte-identical.

.. CG-EXPLANATION-END id=function:collectContactBends

``function hasInterveningBody``
-------------------------------

.. CG-BLOCK id=function:hasInterveningBody lines=500-526

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts
   :language: typescript
   :lines: 500-526
   :lineno-match:

.. CG-EXPLANATION-START id=function:hasInterveningBody

**What this does.** Returns true when a third body -- neither the upper nor the lower band -- sits strictly between the upper band's own base and the matrix-top tie contact on the column where they diverge.

**Why it is here.** The docstring explains this is the signal that the heterogeneous onlap-intervening topology is genuinely present; requiring it stops a ``contact:`` override keyed on a non-clean boundary (a persisted lens node) from spuriously bending a clay-base line no onlap laps.

.. CG-EXPLANATION-END id=function:hasInterveningBody

``function bodyFormation``
--------------------------

.. CG-BLOCK id=function:bodyFormation lines=527-540

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts
   :language: typescript
   :lines: 527-540
   :lineno-match:

.. CG-EXPLANATION-START id=function:bodyFormation

**What this does.** Returns a body's soil identity across the two columns, or nothing if absent.

**Why it is here.** Used to find the upper band's base by soil when its body id is split per column.

.. CG-EXPLANATION-END id=function:bodyFormation

``function upperBandBaseOneCol``
--------------------------------

.. CG-BLOCK id=function:upperBandBaseOneCol lines=541-576

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts
   :language: typescript
   :lines: 541-576
   :lineno-match:

.. CG-EXPLANATION-START id=function:upperBandBaseOneCol

**What this does.** Returns the upper band's own base elevation on one column -- first by matching body id (nearest to the tie contact when the body appears as several units), then falling back to the same-soil band member nearest the contact; returns not-a-number when the band is absent there.

**Why it is here.** The docstring explains the nearest-to-tie choice: a body can appear as several units on one column, and picking the first would report a base far from the contact and spuriously read heterogeneous; nearest-to-tie makes a genuinely flush multi-unit body read flush. The same-soil fallback handles a per-column body split.

.. CG-EXPLANATION-END id=function:upperBandBaseOneCol

``function bodyTopElev``
------------------------

.. CG-BLOCK id=function:bodyTopElev lines=577-583

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts
   :language: typescript
   :lines: 577-583
   :lineno-match:

.. CG-EXPLANATION-START id=function:bodyTopElev

**What this does.** Returns the highest top elevation of a body across the two columns -- its own top, the clamp ceiling.

**Why it is here.** Same shape as the base helper below, providing the upper clamp bound.

.. CG-EXPLANATION-END id=function:bodyTopElev

``function bodyBaseElev``
-------------------------

.. CG-BLOCK id=function:bodyBaseElev lines=584-608

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts
   :language: typescript
   :lines: 584-608
   :lineno-match:

.. CG-EXPLANATION-START id=function:bodyBaseElev

**What this does.** Returns the lowest base elevation of a body across the two columns -- its own base, the clamp floor.

**Why it is here.** The lower clamp bound; the mirror of ``bodyTopElev``.

.. CG-EXPLANATION-END id=function:bodyBaseElev

``function applyContactBend``
-----------------------------

.. CG-BLOCK id=function:applyContactBend lines=609-626

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/contactOverride.ts
   :language: typescript
   :lines: 609-626
   :lineno-match:

.. CG-EXPLANATION-START id=function:applyContactBend

**What this does.** Given a straight band contour and the gap's bends, bends the contour through the matching bend (choosing the confined bend on the flush side) if one matches its per-column elevations, else returns it unchanged.

**Why it is here.** It is applied to both the upper base and the lower top contour; identical elevations produce an identical bend and therefore one shared bent edge. The confined branch is section 113's flush-side rule.

.. CG-EXPLANATION-END id=function:applyContactBend

