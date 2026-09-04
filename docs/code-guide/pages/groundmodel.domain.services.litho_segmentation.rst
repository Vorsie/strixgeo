groundmodel.domain.services.litho_segmentation
==============================================

.. CG-PAGE source=src/groundmodel/domain/services/litho_segmentation.py complete=true

*Source file:* ``src/groundmodel/domain/services/litho_segmentation.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-76

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_segmentation.py
   :language: python
   :lines: 1-76
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the layer *segmenter* and imports its inputs: the
Robertson classification above, a non-normalised fallback classifier, the
admixture and soil-type definitions, and a confidence enum. This file proposes a
list of ground layers for one CPT column or one borehole.

**Why it is here.** After the app knows the soil behaviour at every couple of
centimetres, someone has to draw the *boundaries* — "sand from here to here, then
clay". This file does that, as a *suggestion only*: it never writes to the
database; the engineer accepts or rejects the boundaries. The docstring lays out
the five-step recipe (classify each point, smooth out single-point noise,
group runs, merge runs too thin to be real layers, then describe each layer) and
notes the Phase-4 scope: the Robertson zones are used here only to place
boundaries, never exposed as committed parameters.

.. CG-EXPLANATION-END id=module-header

Function ``def _dr_to_nad_class``
---------------------------------

.. CG-BLOCK id=function:_dr_to_nad_class lines=77-89

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_segmentation.py
   :language: python
   :lines: 77-89
   :lineno-match:

.. CG-EXPLANATION-START id=function:_dr_to_nad_class

**What this does.** Maps a sand's relative density percentage to its clean-sand
NAD packing class (loose, moderate, dense, very dense — classes 5 to 8).

**Why it is here.** Once relative density is known for a sand layer, this turns
that percentage into the packing class the units pane shows. The cut-offs (35, 65
and 85 percent) are the standard loose / moderate / dense / very-dense bands.

.. CG-EXPLANATION-END id=function:_dr_to_nad_class

Class ``LithoLayerSuggestion``
------------------------------

.. CG-BLOCK id=class:LithoLayerSuggestion lines=90-148

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_segmentation.py
   :language: python
   :lines: 90-148
   :lineno-match:

.. CG-EXPLANATION-START id=class:LithoLayerSuggestion

**What this does.** A read-only bundle describing one suggested layer: its top and
base depth, its soil type, a NAD packing class (and the range of classes across
any merged pieces), the mean cone resistance, the relative density, a confidence
level, where it came from (CPT or borehole), and any admixtures. The
``@dataclass(frozen=True)`` makes it a fixed bundle of named values.

**Why it is here.** A suggested layer carries a lot of related facts; naming them
in one immutable object keeps them together and stops any step from accidentally
editing a suggestion in place. The field comments record the rules — for example
that a CPT layer gets a packing class only for clean sand, because the silty and
clayey packing classes need a borehole to confirm.

.. CG-EXPLANATION-END id=class:LithoLayerSuggestion

Function ``def _rolling_median_zones``
--------------------------------------

.. CG-BLOCK id=function:_rolling_median_zones lines=149-179

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_segmentation.py
   :language: python
   :lines: 149-179
   :lineno-match:

.. CG-EXPLANATION-START id=function:_rolling_median_zones

**What this does.** Smooths the sequence of per-point soil zones with a rolling
median: each point is replaced by the middle value of a small window around it.
Undefined points stay undefined.

**Why it is here.** A CPT wobbles point to point — a single spike should not become
its own one-reading layer. A *median* (the middle value) is used rather than an
average because it ignores a lone spike while keeping sharp, real transitions
crisp. The window is sized to the minimum layer thickness so it never smooths away
a layer that is genuinely thin.

.. CG-EXPLANATION-END id=function:_rolling_median_zones

Function ``def _run_length_encode``
-----------------------------------

.. CG-BLOCK id=function:_run_length_encode lines=180-201

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_segmentation.py
   :language: python
   :lines: 180-201
   :lineno-match:

.. CG-EXPLANATION-START id=function:_run_length_encode

**What this does.** Collapses the smoothed sequence into runs: instead of "sand,
sand, sand, clay, clay" it records "sand from index 0 to 3, clay from 3 to 5".

**Why it is here.** Layers are runs of the same soil, so turning the point-by-point
list into runs is the natural next step before deciding which runs are thick
enough to keep.

.. CG-EXPLANATION-END id=function:_run_length_encode

Function ``def _greedy_merge``
------------------------------

.. CG-BLOCK id=function:_greedy_merge lines=202-266

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_segmentation.py
   :language: python
   :lines: 202-266
   :lineno-match:

.. CG-EXPLANATION-START id=function:_greedy_merge

**What this does.** Merges any run that is thinner than the minimum layer
thickness into a neighbour — into the run above it, or, if it is the very top run,
into the run below. It repeats until every remaining run is thick enough or only
one is left. Undefined runs are merged away immediately.

**Why it is here.** Real layers have a minimum sensible thickness; a sliver run is
noise, not a layer. Merging thin runs into their neighbours removes those slivers.
The comment explains that the loop restarts after each merge so shifting indices
never cause a mistake, and that each merge removes exactly one run, which
guarantees the loop ends.

.. CG-EXPLANATION-END id=function:_greedy_merge

Function ``def segment_cpt``
----------------------------

.. CG-BLOCK id=function:segment_cpt lines=267-461

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_segmentation.py
   :language: python
   :lines: 267-461
   :lineno-match:

.. CG-EXPLANATION-START id=function:segment_cpt

**What this does.** The main CPT entry point. It runs the whole recipe: classify
each depth (either the stress-normalised Robertson pipeline or a simpler
non-normalised fallback), smooth, group into runs, merge thin runs, then build one
layer description per surviving run — including mean cone resistance, and for
clean-sand layers a relative density and packing class. Optionally it does a final
pass merging touching same-soil layers.

**Why it is here.** This is where all the pieces above come together into the list
of suggested layers the engineer sees. The comments capture careful choices: the
"clean sand" gate for relative density uses the *raw* friction ratio, not the
normalised one, because the normalised value would wrongly exclude deep loose
sands — exactly the case that matters most for packing (senior review B1,
17 May 2026); and the layers are emitted as a gap-free stack, each layer's base
being the next layer's top, so an engineer drawing contacts from them has no
unassigned gaps. The non-normalised mode is the right choice at shallow depth or
where the effective-stress profile is unreliable, and there it leaves relative
density and packing blank because those need effective stress.

.. CG-EXPLANATION-END id=function:segment_cpt

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=462-466

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_segmentation.py
   :language: python
   :lines: 462-466
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Sets three tuning numbers for how admixtures are rolled up
when layers merge: a 50 percent "dominant" threshold, a 25 percent "pervasive"
threshold, and a floor of 3 layers.

**Why it is here.** They are lifted out as named constants so the owner can tune
them during dogfeeding without reading the function body (debt #66). The two
thresholds catch two different cases: an admixture that dominates one thick layer,
and an admixture that is thin in each layer but present across many — the
geological character of an interbedded sequence.

.. CG-EXPLANATION-END id=module-statements

Function ``def _aggregate_admixtures``
--------------------------------------

.. CG-BLOCK id=function:_aggregate_admixtures lines=467-581

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_segmentation.py
   :language: python
   :lines: 467-581
   :lineno-match:

.. CG-EXPLANATION-START id=function:_aggregate_admixtures

**What this does.** When several observation layers merge into one, this decides
which admixtures the merged layer should carry, weighing each by how much
thickness it spans. An admixture is kept if it dominates (over half the merged
thickness) or if it is pervasive (over a quarter of the thickness and present in
at least three of the source layers). For each kept admixture it picks the amount
variant that spans the most thickness.

**Why it is here.** Merging layers must not silently drop or over-report their
admixtures. The two-threshold rule is honest about both a strongly-sandy clay and
a thinly-but-everywhere silty sequence. Picking the dominant amount keeps the
merged label faithful to the strongest signal rather than an average that belongs
to no real layer.

.. CG-EXPLANATION-END id=function:_aggregate_admixtures

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements~2 lines=582-584

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_segmentation.py
   :language: python
   :lines: 582-584
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements~2

**What this does.** Sets a 1 mm tolerance used to decide whether two layers are
touching.

**Why it is here.** After the gap-free stacking above, floating-point rounding can
leave gaps of a tiny fraction of a millimetre between layers that are really
touching. A generous 1 mm floor treats those as touching so the same-soil merge
below is not fooled by rounding.

.. CG-EXPLANATION-END id=module-statements~2

Function ``def merge_adjacent_same_lithology``
----------------------------------------------

.. CG-BLOCK id=function:merge_adjacent_same_lithology lines=585-670

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_segmentation.py
   :language: python
   :lines: 585-670
   :lineno-match:

.. CG-EXPLANATION-START id=function:merge_adjacent_same_lithology

**What this does.** Collapses neighbouring layers that touch and share the same
soil type into one layer, repeating until nothing more can merge — so a chain of
four sand layers becomes one.

**Why it is here.** The Robertson classification can split one real sand body into
several by packing density; for the *litho* (soil-type) picture those should read
as one sand. This pass joins them. It works on touching, same-soil pairs only, and
hands each group it finds to the collapse helper below.

.. CG-EXPLANATION-END id=function:merge_adjacent_same_lithology

Function ``def _collapse_group``
--------------------------------

.. CG-BLOCK id=function:_collapse_group lines=671-749

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_segmentation.py
   :language: python
   :lines: 671-749
   :lineno-match:

.. CG-EXPLANATION-START id=function:_collapse_group

**What this does.** Merges a run of same-soil layers into one, combining their
numbers sensibly: thickness-weighted averages for cone resistance, relative
density and packing class; the class *range* across the sources; the most
conservative (lowest) confidence; and the re-aggregated admixtures.

**Why it is here.** When several layers become one, the merged layer must report
honest combined numbers. Weighting by thickness means a thick layer counts more
than a thin one; taking the lowest confidence means the merged layer is never more
confident than its shakiest part; and keeping the class range preserves the fact
that the sources were not all identical.

.. CG-EXPLANATION-END id=function:_collapse_group

Function ``def segment_borehole``
---------------------------------

.. CG-BLOCK id=function:segment_borehole lines=750-879

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_segmentation.py
   :language: python
   :lines: 750-879
   :lineno-match:

.. CG-EXPLANATION-START id=function:segment_borehole

**What this does.** The borehole entry point. Instead of classifying cone
readings, it maps each described observation layer's main soil code (from DOV) to
a base soil type, then runs the same run-grouping and thin-run merging as the CPT
path, and can do the same-soil final merge. It carries admixtures through where
they are provided.

**Why it is here.** A borehole already *describes* the soil, so there is no
Robertson maths to do — but the same layer-tidying logic applies, so it reuses the
run-length and greedy-merge helpers. Packing class and relative density are left
blank because those need a CPT's cone resistance, which a borehole does not have.
Unknown or unmappable soil codes are skipped rather than allowed to crash the
run.

.. CG-EXPLANATION-END id=function:segment_borehole

