groundmodel.application.stratigraphy_scan
=========================================

.. CG-PAGE source=src/groundmodel/application/stratigraphy_scan.py complete=true

*Source file:* ``src/groundmodel/application/stratigraphy_scan.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../src/groundmodel/application/stratigraphy_scan.py
   :language: python
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for the candidate scan — the read-only walk over each borehole's stratigraphy that the discover endpoint uses.

**Why it is here.** Extracted verbatim from the auto-populate file (debt #178/#201) so the preview runs the identical formal-preferred/informal-fallback logic as the writer, without the contact-creation side effects.

.. CG-EXPLANATION-END id=module-header

Function ``async def scan_stratigraphy_candidates``
---------------------------------------------------

.. CG-BLOCK id=function:scan_stratigraphy_candidates lines=34-221

.. literalinclude:: ../../../src/groundmodel/application/stratigraphy_scan.py
   :language: python
   :lines: 34-221
   :lineno-match:

.. CG-EXPLANATION-START id=function:scan_stratigraphy_candidates

**What this does.** Loads the requested boreholes with their observations and layers in one round-trip, then walks each borehole's primary stream shallowest-first: for every layer it finds the best-overlap counterpart, derives the name/reference/key triple, resolves the effective key through the shared lump-and-bridge helper, and tallies which boreholes carry each effective key. It also records, per borehole and per effective key, every layer that landed there, so it can emit a collision warning wherever two layers in one borehole resolve to the same formation (keeping the shallowest). It returns the candidates sorted by borehole count then name, plus the collisions.

**Why it is here.** It mirrors the write path's execute step exactly, through the same shared helpers, so the discover-equals-apply invariant holds — key divergence between the two was the original bug this shared code fixed. Shallowest-wins on a same-borehole collision because the shallowest is the formation's first appearance and two tops for one formation would corrupt the surface triangulation.

.. CG-EXPLANATION-END id=function:scan_stratigraphy_candidates

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=222-236

.. literalinclude:: ../../../src/groundmodel/application/stratigraphy_scan.py
   :language: python
   :lines: 222-236
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Defines the default colour palette: a fixed tuple of ten hex colours used to give an auto-created formation a starting hue.

**Why it is here.** Auto-created formations need a visible default colour before the engineer renames and recolours them; a fixed cycling palette keeps the choice deterministic so the same description always gets the same hue.

.. CG-EXPLANATION-END id=module-statements

Function ``def _palette_colour_for``
------------------------------------

.. CG-BLOCK id=function:_palette_colour_for lines=237-244

.. literalinclude:: ../../../src/groundmodel/application/stratigraphy_scan.py
   :language: python
   :lines: 237-244
   :lineno-match:

.. CG-EXPLANATION-START id=function:_palette_colour_for

**What this does.** Turns a formation name into a stable index into the palette by hashing the characters, so the same string always maps to the same colour.

**Why it is here.** Determinism means a re-run does not reshuffle colours; the palette is only a "don't be invisible" default the engineer overrides.

.. CG-EXPLANATION-END id=function:_palette_colour_for

