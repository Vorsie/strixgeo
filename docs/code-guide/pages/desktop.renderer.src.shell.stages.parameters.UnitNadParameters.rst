desktop.renderer.src.shell.stages.parameters.UnitNadParameters
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/UnitNadParameters.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/UnitNadParameters.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitNadParameters.tsx
   :language: tsx
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file describing the "NAD characteristic values" block — a small panel that shows one body's row of NAD packing-class values — and imports the translator hook, the class-name helper, and the type of the value bundle it displays.

**Why it is here.** An owner ruling on 2026-09-05 asked that the NAD values (dry and wet unit weight, φ′, c′, cᵤ) be available in the unit view but kept SEPARATE from the per-unit statistics. The comment stresses the block is a table READ, never a derivation: the numbers are read verbatim from the published table for the class, with a dash where the table itself carries none (no undrained shear for a granular class). These are characterisation values, not design values — the CLAUDE.md scope boundary keeps φ′/c′/cᵤ that would feed a design check in Phase 5; here they are shown as read from NBN EN 1997-1 ANB Tabel 2.1 (the Belgian national annex to Eurocode 7). It draws nothing when the scope has no single class or no table row.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=20-28

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitNadParameters.tsx
   :language: tsx
   :lines: 20-28
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Names the two inputs the block takes: the unit's single NAD packing class (or ``null``), and that class's characteristic values (or ``null`` when no table row exists).

**Why it is here.** Both can legitimately be absent — a litho unit, a mixed scope or an unclassified body has no single class, and an older engine response may not carry the value bundle — so both are allowed to be ``null`` and the block simply shows nothing in those cases.

.. CG-EXPLANATION-END id=interface:Props

``const KN_M3``
---------------

.. CG-BLOCK id=const:KN_M3 lines=29-29

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitNadParameters.tsx
   :language: tsx
   :lines: 29-29
   :lineno-match:

.. CG-EXPLANATION-START id=const:KN_M3

**What this does.** Holds the unit string ``kN/m³`` for the two unit-weight rows.

**Why it is here.** The comment explains that a symbol and its unit are universal notation, like an axis symbol, so they are never translated — only the descriptive name and the block's chrome are. Keeping the unit as a named constant states that once.

.. CG-EXPLANATION-END id=const:KN_M3

``const KPA``
-------------

.. CG-BLOCK id=const:KPA lines=30-30

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitNadParameters.tsx
   :language: tsx
   :lines: 30-30
   :lineno-match:

.. CG-EXPLANATION-START id=const:KPA

**What this does.** Holds the unit string ``kPa`` for the cohesion and undrained-shear rows.

**Why it is here.** Same reason as the unit-weight unit: a physical unit is universal notation and is written once, not translated.

.. CG-EXPLANATION-END id=const:KPA

``const DEG``
-------------

.. CG-BLOCK id=const:DEG lines=31-38

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitNadParameters.tsx
   :language: tsx
   :lines: 31-38
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEG

**What this does.** Holds the degree symbol ``°`` for the friction-angle row.

**Why it is here.** Same reason: the degree sign is universal notation, kept as a named constant rather than translated per language.

.. CG-EXPLANATION-END id=const:DEG

``function UnitNadParameters``
------------------------------

.. CG-BLOCK id=function:UnitNadParameters lines=39-124

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitNadParameters.tsx
   :language: tsx
   :lines: 39-124
   :lineno-match:

.. CG-EXPLANATION-START id=function:UnitNadParameters

**What this does.** The component that draws the block. If there is no single class or no value row it returns nothing. Otherwise it builds five rows — dry unit weight γd, saturated unit weight γsat, friction angle φ′, cohesion c′ and undrained shear cᵤ, each with its symbol, translated name and value — and lays them out as a titled card, ending with a line naming the class (the provenance) and the standing caveat.

**Why it is here.** The undrained-shear row shows a dash, never "0 kPa", when the table carries none for a granular class — a zero would read as a measured value. The symbols are subscripted the way gINT and D-Series parameter tables write them so the two γ rows are distinguishable by symbol alone (owner review 2026-09-05). The caveat text uses the ``secondary`` colour rather than the ``muted`` one because ``muted`` fails WCAG 2.2 AA contrast at this small size, and this is the liability-bearing line — that these are characterisation values the engineer must not paste straight into a design check — so it has to stay legible.

.. CG-EXPLANATION-END id=function:UnitNadParameters

