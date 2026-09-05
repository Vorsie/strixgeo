groundmodel.domain.services.geotech_edge_bridging
=================================================

.. CG-PAGE source=src/groundmodel/domain/services/geotech_edge_bridging.py complete=true

*Source file:* ``src/groundmodel/domain/services/geotech_edge_bridging.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_edge_bridging.py
   :language: python
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the module and imports ``deque`` (a double-ended
list used as a queue) and ``UUID``. Its one job: add CPT-to-CPT litho
correlation pairs that skip over columns carrying no packing bands.

**Why it is here.** Geotech packing ties are derived from the parent litho
model's approved correlations, and that works only when BOTH ends of a litho
correlation carry geotech bands. In the four-step pipeline (owner ruling
2026-08-04) auto-correlate runs BEFORE "Divide boreholes", so every borehole
column is deliberately still empty — a section drawn CPT - borehole - CPT would
then propose nothing, because each of its two litho correlations has one empty
end. The v2 partition engine already supports jump ties, so this module bridges
CPT to CPT across the undivided middle. It is a pure domain module (no
database, no logging) so the whole decision can be tested on its own.

.. CG-EXPLANATION-END id=module-header

Function ``def bridge_litho_edges_over_bandless_columns``
---------------------------------------------------------

.. CG-BLOCK id=function:bridge_litho_edges_over_bandless_columns lines=41-129

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_edge_bridging.py
   :language: python
   :lines: 41-129
   :lineno-match:

.. CG-EXPLANATION-START id=function:bridge_litho_edges_over_bandless_columns

**What this does.** Builds a graph — a set of layers joined by their approved
correlations — then from every band-carrying "terminal" layer walks the graph
breadth-first (nearest neighbours first) through band-less "transit" layers
only, stops at the first terminal it reaches, and adds a canonical pair joining
the two terminals. A pair on the same investigation is never emitted. It
returns the original correlations plus the new bridged pairs.

**Why it is here.** Terminal-versus-transit is judged per LAYER, not per
column: a column whose bands all sit in a different litho unit has nothing to
align inside this chain's depth window, so for this walk it counts as transit,
exactly as if it carried no bands. Expansion stops at the first terminal on
purpose — a chain of three divided columns already has its own two
correlations, and an end-to-end shortcut would tie bands the engineer never put
next to each other. The result is always a superset of the input: this adds, it
never drops a correlation he approved.

.. CG-EXPLANATION-END id=function:bridge_litho_edges_over_bandless_columns

Function ``def bridged_contact_pairs``
--------------------------------------

.. CG-BLOCK id=function:bridged_contact_pairs lines=130-234

.. literalinclude:: ../../../src/groundmodel/domain/services/geotech_edge_bridging.py
   :language: python
   :lines: 130-234
   :lineno-match:

.. CG-EXPLANATION-START id=function:bridged_contact_pairs

**What this does.** A second bridge that walks CONTACTS instead of layers. It
builds a graph whose nodes are depths on columns — taken from the approved
direct litho ties — then from every terminal contact walks transit contacts
only, connects to each terminal contact it reaches, and returns one (layer,
side)-labelled pair per bridged chain. What packing class the arriving bands
hold is not consulted.

**Why it is here.** Owner corrections, 2026-08-17: *"just walk a tie to the
next cpt, if it arrives you place a direct connection if not then skip"*, and
*"litho ties are packing agnostic ... interpreting and emitting ties based on
packing"*. A node is a depth on a column, never a (layer, side) label, because
the same physical contact is stored as one layer's base and its neighbour's
top, and a label-keyed walk dies exactly at the hop where the two rows disagree
— the xyz ruling, in its third appearance. The label only rides along so an
emitted pair can name real rows; identity is the depth node alone, rounded to
the millimetre grid the litho depths are stored on.

.. CG-EXPLANATION-END id=function:bridged_contact_pairs

