desktop.renderer.src.utils.geotechBodyLabel
===========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechBodyLabel.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechBodyLabel.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBodyLabel.ts
   :language: typescript
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file holds the one vocabulary used to auto-label a geotech body — soil word plus packing token plus ordinal, for example "SILT · SF #0". The comment records a dogfeed confusion (2026-09-01): a geotech body used to read "SF #0" (packing only) in the stats jump and got mistaken for a litho body's "SILT · #0"; it now reads "SILT · SF #0" so the two are unambiguous. Because every surface that shows a body name calls this one helper, the label reads identically everywhere. It imports the language type and the compact NAD label helper.

**Why it is here.** The reasons are recorded in the comment. Having one helper is what makes the label consistent across the Parameters pane, the scope header, the section body-menu header and the geotech units pane. The language rule follows the platform's translate-at-the-presentation-boundary convention: the soil word follows the interface language (Dutch renders "ZAND"), while the packing token stays English (owner ruling 19, "ZAND·MD stands"). Both come straight from the compact label helper, so this file adds only the spacing and the ordinal and never introduces a second vocabulary. The packing token is a Belgian-annex characterisation label (NBN EN 1997-1 ANB Tabel 2.1).

.. CG-EXPLANATION-END id=module-header

``function nadSoilPackingLabel``
--------------------------------

.. CG-BLOCK id=function:nadSoilPackingLabel lines=41-64

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBodyLabel.ts
   :language: typescript
   :lines: 41-64
   :lineno-match:

.. CG-EXPLANATION-START id=function:nadSoilPackingLabel

**What this does.** Turns a NAD class number into its spaced soil-plus-packing abbreviation — for example "SILT · SF" (Dutch "ZAND · MD"). It takes the compact middot-joined form from the shared helper and re-spaces the middot to " · " so it reads as a label rather than a code; an out-of-range class that has no middot passes through unchanged.

**Why it is here.** This is a *formatter* — a pure function turning a value into display text (the pattern introduced on the ``formatNadClass`` page). Re-spacing only, and taking the words themselves from the shared compact helper, keeps this from becoming a second copy of the soil/packing vocabulary.

.. CG-EXPLANATION-END id=function:nadSoilPackingLabel

``function geotechBodyAutoLabel``
---------------------------------

.. CG-BLOCK id=function:geotechBodyAutoLabel lines=65-71

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBodyLabel.ts
   :language: typescript
   :lines: 65-71
   :lineno-match:

.. CG-EXPLANATION-START id=function:geotechBodyAutoLabel

**What this does.** Builds a geotech body's automatic label — the soil-plus-packing abbreviation followed by the body's own 0-based ordinal, giving "SILT · SF #0".

**Why it is here.** This is the form a body shows when the engineer has not given it a name; the ordinal is numbered the same 0-based way the 3-D legend numbers bodies, so a body reads the same number wherever it appears.

.. CG-EXPLANATION-END id=function:geotechBodyAutoLabel

