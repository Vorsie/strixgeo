groundmodel.application.stratigraphy_bridge
===========================================

.. CG-PAGE source=src/groundmodel/application/stratigraphy_bridge.py complete=true

*Source file:* ``src/groundmodel/application/stratigraphy_bridge.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../src/groundmodel/application/stratigraphy_bridge.py
   :language: python
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for the shared stratigraphy helpers: building the project-wide formal-to-informal name bridge, resolving a layer's effective formation key, and the max-overlap pairing of two streams' layers.

**Why it is here.** These helpers were lifted verbatim out of the auto-populate file so the discover preview, the write path and the seed all call the exact same code (debt #178/#201). Keeping one copy is what guarantees the two paths can never drift in how they name or key a layer.

.. CG-EXPLANATION-END id=module-header

Function ``async def build_formal_informal_bridge``
---------------------------------------------------

.. CG-BLOCK id=function:build_formal_informal_bridge lines=38-198

.. literalinclude:: ../../../src/groundmodel/application/stratigraphy_bridge.py
   :language: python
   :lines: 38-198
   :lineno-match:

.. CG-EXPLANATION-START id=function:build_formal_informal_bridge

**What this does.** Scans every borehole in the project that carries BOTH a formal and an informal stratigraphy stream. For each such "dual-stream" borehole it pairs formal and informal layers by largest depth-overlap and casts one vote: this formal code means this informal name. When different boreholes disagree about a code, the most-voted name wins, ties broken alphabetically for determinism, and a warning is logged. It returns a dictionary mapping normalised formal code to normalised informal name, empty when the project has no dual-stream borehole.

**Why it is here.** Formal-only boreholes have no informal counterpart of their own; this data-proven table lets their codes merge with the informal-named units the rest of the project uses (locked 2026-05-18). It is recomputed per request rather than stored because it is just a derivation of layer rows already present, and persisting it would need a provenance column and a migration (Data Integrity Rule 1). Project data is authoritative, so a local naming convention can outvote the global table.

.. CG-EXPLANATION-END id=function:build_formal_informal_bridge

Function ``def _resolve_codelist_canonical``
--------------------------------------------

.. CG-BLOCK id=function:_resolve_codelist_canonical lines=199-253

.. literalinclude:: ../../../src/groundmodel/application/stratigraphy_bridge.py
   :language: python
   :lines: 199-253
   :lineno-match:

.. CG-EXPLANATION-START id=function:_resolve_codelist_canonical

**What this does.** Looks a normalised formal code up in the curated DOV formal-stratigraphy lexicon and returns its full canonical Dutch name, or nothing on a miss. It handles both a single atomic code and the parser's compound "member1-relation-member2" shape, resolving each side and joining them with the relation word; if either side is unknown the whole compound is a miss.

**Why it is here.** This fills the gap the bridge leaves for formal-only boreholes with no dual-stream partner in the project (#59, about 403 codes parsed from DOV's own schema). A sentinel code such as "unknown" is treated as a miss so the raw token survives — the lexicon is strictly additive and never invents a half-resolved name.

.. CG-EXPLANATION-END id=function:_resolve_codelist_canonical

Function ``def _resolve_bridge_key``
------------------------------------

.. CG-BLOCK id=function:_resolve_bridge_key lines=254-311

.. literalinclude:: ../../../src/groundmodel/application/stratigraphy_bridge.py
   :language: python
   :lines: 254-311
   :lineno-match:

.. CG-EXPLANATION-START id=function:_resolve_bridge_key

**What this does.** For a formal layer's raw key it applies, in order: the in-project bridge first, then the #59 DOV lexicon, else returns the raw key unchanged. It returns the resolved key plus the human-readable canonical name (only when the lexicon supplied it). Informal keys are returned untouched.

**Why it is here.** The precedence is stated in the docstring: project-proven equivalences beat the global curated table because project data is authoritative, and the lexicon is the fallback for the no-dual-stream case. A name is never invented — a miss keeps the raw token.

.. CG-EXPLANATION-END id=function:_resolve_bridge_key

Function ``def _derive_layer_names_and_key``
--------------------------------------------

.. CG-BLOCK id=function:_derive_layer_names_and_key lines=312-369

.. literalinclude:: ../../../src/groundmodel/application/stratigraphy_bridge.py
   :language: python
   :lines: 312-369
   :lineno-match:

.. CG-EXPLANATION-START id=function:_derive_layer_names_and_key

**What this does.** For one primary layer it produces the (display name, regional reference, stable key) triple following the DOV split convention: the informal description is the working name, the formal code is the regional reference, each falling back to the primary stream's own description when the other stream has no counterpart. The stable key is the normalised regional reference when formal is present, else the normalised name.

**Why it is here.** The docstring calls this the single source of truth for naming and identity, used by both the discover scan and the write path so the stable key is provably identical on both sides — this shared function is what fixed the earlier discover-versus-write key-divergence bug. Normalising the key makes dash/space/case and chronological-prefix variants of one unit merge.

.. CG-EXPLANATION-END id=function:_derive_layer_names_and_key

Function ``def _resolve_effective_key``
---------------------------------------

.. CG-BLOCK id=function:_resolve_effective_key lines=370-418

.. literalinclude:: ../../../src/groundmodel/application/stratigraphy_bridge.py
   :language: python
   :lines: 370-418
   :lineno-match:

.. CG-EXPLANATION-START id=function:_resolve_effective_key

**What this does.** Applies the engineer's manual lump map to a raw key: when the raw key appears in the map it returns the target formation's normalised key and the target display name, otherwise the raw key unchanged. A blank target is treated as unmapped so no nameless formation is ever created.

**Why it is here.** The effective key is the formation's identity, and that identity is the typographic normalisation of whatever name the engineer chose — so two raw names lumped to one target produce the same key as a raw name that already IS that target. The blank-target guard stops an empty lump from minting a formation with no name.

.. CG-EXPLANATION-END id=function:_resolve_effective_key

Function ``def _resolve_lumped_key``
------------------------------------

.. CG-BLOCK id=function:_resolve_lumped_key lines=419-525

.. literalinclude:: ../../../src/groundmodel/application/stratigraphy_bridge.py
   :language: python
   :lines: 419-525
   :lineno-match:

.. CG-EXPLANATION-START id=function:_resolve_lumped_key

**What this does.** The full precedence resolver for one raw key: (1) an explicit manual lump on the raw key wins outright; (2) else the in-project bridge; (3) else the #59 lexicon; (4) the manual lump is re-checked on the resolved identity so the engineer can still lump the candidate the dialog shows; (5) else the raw key unchanged. It returns the effective key, the effective display name, and a flag saying whether that name is authoritative.

**Why it is here.** Named the single source of truth for the bridge-versus-lump precedence, shared verbatim by the discover preview and the write path so the effective key is identical on both — the discover-equals-apply-equals-seed invariant. Raw-lump-first is load-bearing for backward use (revised 2026-05-18): a lumping map saved in an older project file was keyed on the pre-bridge raw formal codes, and putting the bridge first would rewrite the key out from under those saved entries and silently drop the lump. The known asymmetry when only one of a formal/informal pair is hand-lumped is documented and accepted.

.. CG-EXPLANATION-END id=function:_resolve_lumped_key

Function ``def _find_observation``
----------------------------------

.. CG-BLOCK id=function:_find_observation lines=526-541

.. literalinclude:: ../../../src/groundmodel/application/stratigraphy_bridge.py
   :language: python
   :lines: 526-541
   :lineno-match:

.. CG-EXPLANATION-START id=function:_find_observation

**What this does.** Returns the borehole's first observation of the requested kind (formal or informal stratigraphy), or nothing when it has none.

**Why it is here.** DOV does not ship two formal interpretations for one boring, so in practice the first match IS the match.

.. CG-EXPLANATION-END id=function:_find_observation

Function ``def _best_overlap``
------------------------------

.. CG-BLOCK id=function:_best_overlap lines=542-569

.. literalinclude:: ../../../src/groundmodel/application/stratigraphy_bridge.py
   :language: python
   :lines: 542-569
   :lineno-match:

.. CG-EXPLANATION-START id=function:_best_overlap

**What this does.** Given a depth interval and a list of candidate layers, returns the candidate with the largest depth-overlap, computed as the length of the intersection, or nothing when none overlaps.

**Why it is here.** This is how a layer in one stream is paired with its counterpart in the other. Its argument type is deliberately loose because callers pass borehole-layer rows by shape (top/base/description attributes); a precise type would force a circular import.

.. CG-EXPLANATION-END id=function:_best_overlap

