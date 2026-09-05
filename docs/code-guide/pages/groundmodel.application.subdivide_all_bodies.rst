groundmodel.application.subdivide_all_bodies
============================================

.. CG-PAGE source=src/groundmodel/application/subdivide_all_bodies.py complete=true

*Source file:* ``src/groundmodel/application/subdivide_all_bodies.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-213

.. literalinclude:: ../../../src/groundmodel/application/subdivide_all_bodies.py
   :language: python
   :lines: 1-213
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the "subdivide all bodies" use case — the
classify-and-materialise step of the geotech flow. It gathers the imports for the
per-CPT segmenter, the body aggregator, the shared edge derivation, the tie
re-anchor, the partition locks and the database rows, and records the design in
its docstring.

**Why it is here.** This is one of the two main geotech use cases. It groups the
litho picks by (body, geological unit), runs the segmenter on each CPT member,
decides a consistent multi-band split versus a single class, and materialises real
geotech bands as ``litho_layer`` rows so they render through the same engine as
the lithology. The docstring states the key architecture: geotech LAYERS are
model-wide (a column's packing bands depend only on its own qc and its body
membership, the same on any section that views it) while geotech EDGES are
per-section. It lists what it persists in one transaction (layer rows, correlation
edges, body rows) and the two rules that make a re-run safe: the idempotent reset
deletes exactly what it rebuilds, and accepted ties survive by being captured
before the wipe and re-anchored after. Boreholes are deliberately NOT classified
here — they leave with no class, and "divide boreholes" classifies them later,
always SAME-SOIL (a packing class describes one soil column; a silt's firmness is
no evidence about a sand — owner 2026-08-26).

.. CG-EXPLANATION-END id=module-header

Class ``SubdivideAllBodiesResult``
----------------------------------

.. CG-BLOCK id=class:SubdivideAllBodiesResult lines=214-317

.. literalinclude:: ../../../src/groundmodel/application/subdivide_all_bodies.py
   :language: python
   :lines: 214-317
   :lineno-match:

.. CG-EXPLANATION-START id=class:SubdivideAllBodiesResult

**What this does.** A frozen dataclass returning the run's outcome: the geotech
model id, the formations created, the layer and body counts, the split /
one-class / borehole-only tallies, the section count, the tie re-anchor results
(carried, needs-review, and lost with reasons and labels), whether edges were
derived and how many were proposed, and the skipped counts (off-section,
already-subdivided) with their labels.

**Why it is here.** Nearly every field exists so that a silent surprise cannot
reach an export. The lost-tie labels are carried because a count alone cannot be
acted on — the engineer needs to know WHERE the accepted work vanished (audit
2026-08-02). The off-section labels are carried because a model that came out
smaller on purpose must say which of his interpreted columns were left out and
why. ``edges_derived`` is carried so the caller can tell the engineer that
auto-correlate is his next press, rather than leaving him to guess why no ties
appeared.

.. CG-EXPLANATION-END id=class:SubdivideAllBodiesResult

Function ``def _mm_clamped_intervals``
--------------------------------------

.. CG-BLOCK id=function:_mm_clamped_intervals lines=318-363

.. literalinclude:: ../../../src/groundmodel/application/subdivide_all_bodies.py
   :language: python
   :lines: 318-363
   :lineno-match:

.. CG-EXPLANATION-START id=function:_mm_clamped_intervals

**What this does.** Clamps a segment's packing splits into its geological extent,
rounds both to the millimetre grid, and drops any that degenerate to nothing.

**Why it is here.** The splits arrive already millimetre-rounded, but the
geological bounds arrive RAW from the surface interpolation; clamping rounded edges
against raw bounds once put the band above and the band below a shared boundary on
two different values of the same physical depth, leaving sub-millimetre no-band
slivers that made the drag-merge refuse (audit F13). Rounding the BOUNDS first puts
every edge on one grid, so two segments sharing a boundary meet exactly. A band may
thereby extend up to half a millimetre past the raw surface — far inside the
database's contiguity tolerance and below anything a render or export resolves.

.. CG-EXPLANATION-END id=function:_mm_clamped_intervals

Class ``_ColumnPlan``
---------------------

.. CG-BLOCK id=class:_ColumnPlan lines=364-404

.. literalinclude:: ../../../src/groundmodel/application/subdivide_all_bodies.py
   :language: python
   :lines: 364-404
   :lineno-match:

.. CG-EXPLANATION-START id=class:_ColumnPlan

**What this does.** A private dataclass holding one column's computed sub-band plan
for a body group: the investigation and its kind, the geological extent, the
(top, base) of each band, the class of each band, and the litho layer the plan
subdivides.

**Why it is here.** The class per band is the CPT's OWN segmentation class, not a
body-consensus class, so each test segments by its own qc; ``None`` marks the
skeleton path (a borehole, or a CPT with no usable qc). The litho parent is stamped
so the Parameters tree can place the band under its litho body.

.. CG-EXPLANATION-END id=class:_ColumnPlan

Class ``SubdivideAllBodies`` — header
-------------------------------------

.. CG-BLOCK id=class:SubdivideAllBodies lines=405-432

.. literalinclude:: ../../../src/groundmodel/application/subdivide_all_bodies.py
   :language: python
   :lines: 405-432
   :lineno-match:

.. CG-EXPLANATION-START id=class:SubdivideAllBodies

**What this does.** The use-case class header. It extends the shared materialiser
base and documents the model-wide-layers / per-section-edges design and the fact
that borehole division was extracted into a separate use case.

**Why it is here.** It inherits the find-or-create and grouping helpers from the
materialiser base. Borehole TIN-division was pulled into "divide boreholes" so
borehole bands can be re-materialised after manual correlations without wiping CPT
data. The caller owns the session; this use case commits once at the end.

.. CG-EXPLANATION-END id=class:SubdivideAllBodies

Method ``SubdivideAllBodies``. ``def __init__``
-----------------------------------------------

.. CG-BLOCK id=method:SubdivideAllBodies.__init__ lines=433-437

.. literalinclude:: ../../../src/groundmodel/application/subdivide_all_bodies.py
   :language: python
   :lines: 433-437
   :lineno-match:

.. CG-EXPLANATION-START id=method:SubdivideAllBodies.__init__

**What this does.** Initialises the shared base with this module's name.

**Why it is here.** Passing ``__name__`` makes the log lines read as coming from
this use case, not from the base class.

.. CG-EXPLANATION-END id=method:SubdivideAllBodies.__init__

Method ``SubdivideAllBodies``. ``async def execute``
----------------------------------------------------

.. CG-BLOCK id=method:SubdivideAllBodies.execute lines=438-1327

.. literalinclude:: ../../../src/groundmodel/application/subdivide_all_bodies.py
   :language: python
   :lines: 438-1327
   :lineno-match:

.. CG-EXPLANATION-START id=method:SubdivideAllBodies.execute

**What this does.** The one public entry point — the whole subdivide pipeline in a
single transaction. It validates the requested qc statistic; loads and
scope-guards the litho model; takes the body-partition locks (litho parent, then
geotech child) BEFORE any write; ensures the geotech child model; resolves the
litho body ids; loads the litho picks and keeps only the in-scope ones (reporting
the off-section ones by name); optionally skips columns already subdivided;
captures the engineer's accepted ties, separations and unions before the wipe;
deletes the geotech data it is about to rebuild (the whole model, or one section's
columns); reads back the surviving bands; groups the segments by (body, geological
unit); segments each CPT by its own qc and writes one band per split; re-anchors
the captured ties, separations and unions onto the rebuilt bands; derives the
per-section correlation edges (unless bands-only was asked); runs the body
resolver; stamps the qc statistic and the litho provenance; sweeps orphaned
formations; and commits once — returning the full result.

**Why it is here.** Every ordering here is load-bearing, and the comments cite the
reason for each. The locks are taken before the first write because the verb
rewrites TWO body partitions and used to take each lock too late, racing the
background body recompute into a deadlock (owner dogfeed 2026-08-23). The requested
statistic is applied ONLY when this call CREATES the geotech model, so a re-run can
never re-classify a whole model from a stale renderer (ruling 8). The membership
filter is applied to the picks, not the query, precisely because the difference
between the two sets is the report the engineer needs. A scoped run wipes ONLY its
own columns, so two sections can be subdivided at once (owner 2026-08-15), while the
body delete and the formation find-or-create stay model-wide by nature. The
accepted ties are captured before the wipe and re-anchored after, inside the one
transaction, so a failure leaves neither half applied. Even the empty-picks path
runs the reset, because stale bands from a prior run must not survive a litho model
that was later emptied.

.. CG-EXPLANATION-END id=method:SubdivideAllBodies.execute

Method ``SubdivideAllBodies``. ``def _anchor_in``
-------------------------------------------------

.. CG-BLOCK id=method:SubdivideAllBodies._anchor_in lines=1328-1348

.. literalinclude:: ../../../src/groundmodel/application/subdivide_all_bodies.py
   :language: python
   :lines: 1328-1348
   :lineno-match:

.. CG-EXPLANATION-START id=method:SubdivideAllBodies._anchor_in

**What this does.** Builds the SQL predicate that matches band rows anchored on any
of a set of investigations, OR-ing the CPT and borehole columns.

**Why it is here.** The band table carries a database XOR over its two anchor
columns, so one predicate per column, OR'd together, names the investigation
whichever kind it is. It is a static method — it needs no instance state.

.. CG-EXPLANATION-END id=method:SubdivideAllBodies._anchor_in

Method ``SubdivideAllBodies``. ``async def _delete_all_geotech_data``
---------------------------------------------------------------------

.. CG-BLOCK id=method:SubdivideAllBodies._delete_all_geotech_data lines=1349-1467

.. literalinclude:: ../../../src/groundmodel/application/subdivide_all_bodies.py
   :language: python
   :lines: 1349-1467
   :lineno-match:

.. CG-EXPLANATION-START id=method:SubdivideAllBodies._delete_all_geotech_data

**What this does.** The idempotent reset: it deletes the model's prior geotech data
in a foreign-key-safe order — the dirty (unaccepted) edges, then the layers (whose
trigger removes their contact mirrors), then any directly-written contact rows,
then the bodies — either for the whole model or for one section's columns.

**Why it is here.** The order and the scope are both spelled out in the comments.
Accepted ties are spared by the edge statement but taken anyway by the endpoint
cascade when their layers are deleted — no ``WHERE`` clause can prevent it, because
the rebuild re-derives every band with a fresh id, so the tie is preserved one
level up (capture then re-anchor). The scoped mode selects edges by ENDPOINT, not by
section, because it is the column being rebuilt — not the section it is drawn on —
that makes an edge stale. Bodies are deleted only in the wholesale mode: bodies are
model-wide by nature, so a scoped run leaves them for the resolver to reconcile
rather than stripping the names, colours and hand-drawn boundaries off the sections
it never touched.

.. CG-EXPLANATION-END id=method:SubdivideAllBodies._delete_all_geotech_data

Method ``SubdivideAllBodies``. ``def _build_column_plans``
----------------------------------------------------------

.. CG-BLOCK id=method:SubdivideAllBodies._build_column_plans lines=1468-1561

.. literalinclude:: ../../../src/groundmodel/application/subdivide_all_bodies.py
   :language: python
   :lines: 1468-1561
   :lineno-match:

.. CG-EXPLANATION-START id=method:SubdivideAllBodies._build_column_plans

**What this does.** Builds one sub-interval plan per column in a body group: a CPT
uses its own segmentation splits (clamped to the geological extent); a borehole, or
a CPT with no usable qc, gets one class-less band over the whole extent.

**Why it is here.** PER-CPT (owner directive 2026-06-25): each test segments by its
OWN qc, not by a body consensus, so a sand whose qc crosses the thresholds splits
on THIS test even if its neighbours disagree. The profile is keyed by
(investigation, top depth), because one CPT can carry two segments in the same body
group, and an investigation-only key would overwrite the first with the second. The
skeleton band uses the same millimetre grid, so it meets its neighbours exactly.

.. CG-EXPLANATION-END id=method:SubdivideAllBodies._build_column_plans

Method ``SubdivideAllBodies``. ``async def _load_cpt_series``
-------------------------------------------------------------

.. CG-BLOCK id=method:SubdivideAllBodies._load_cpt_series lines=1562-1587

.. literalinclude:: ../../../src/groundmodel/application/subdivide_all_bodies.py
   :language: python
   :lines: 1562-1587
   :lineno-match:

.. CG-EXPLANATION-START id=method:SubdivideAllBodies._load_cpt_series

**What this does.** Loads the qc-series rows for a set of CPT ids.

**Why it is here.** The segmenter needs each CPT's depth-and-qc arrays; the row is
absent for a CPT that carries no series.

.. CG-EXPLANATION-END id=method:SubdivideAllBodies._load_cpt_series

Method ``SubdivideAllBodies``. ``async def _read_gradient_snap``
----------------------------------------------------------------

.. CG-BLOCK id=method:SubdivideAllBodies._read_gradient_snap lines=1588-1616

.. literalinclude:: ../../../src/groundmodel/application/subdivide_all_bodies.py
   :language: python
   :lines: 1588-1616
   :lineno-match:

.. CG-EXPLANATION-START id=method:SubdivideAllBodies._read_gradient_snap

**What this does.** Reads the gradient-snap knobs (enabled, and the window in
metres) from the project settings, defaulting to on with a 0.5 m window.

**Why it is here.** The segmenter can snap a packing boundary onto a nearby change
in the qc gradient; these knobs tune that, and they live in the geotech settings
box so they never move the litho segmenter's own.

.. CG-EXPLANATION-END id=method:SubdivideAllBodies._read_gradient_snap

Method ``SubdivideAllBodies``. ``async def _formation_soil_code``
-----------------------------------------------------------------

.. CG-BLOCK id=method:SubdivideAllBodies._formation_soil_code lines=1617-1632

.. literalinclude:: ../../../src/groundmodel/application/subdivide_all_bodies.py
   :language: python
   :lines: 1617-1632
   :lineno-match:

.. CG-EXPLANATION-START id=method:SubdivideAllBodies._formation_soil_code

**What this does.** Reads the main soil code from a formation row.

**Why it is here.** The segmenter and the soil-family clamp both need the parent
unit's soil.

.. CG-EXPLANATION-END id=method:SubdivideAllBodies._formation_soil_code

Method ``SubdivideAllBodies``. ``async def _formation_admixtures``
------------------------------------------------------------------

.. CG-BLOCK id=method:SubdivideAllBodies._formation_admixtures lines=1633-1658

.. literalinclude:: ../../../src/groundmodel/application/subdivide_all_bodies.py
   :language: python
   :lines: 1633-1658
   :lineno-match:

.. CG-EXPLANATION-START id=method:SubdivideAllBodies._formation_admixtures

**What this does.** Reads and parses a formation's stored admixtures into domain
admixture objects.

**Why it is here.** The admixtures pick the clean versus secondary NAD column, so
the segmenter needs them.

.. CG-EXPLANATION-END id=method:SubdivideAllBodies._formation_admixtures

Method ``SubdivideAllBodies``. ``async def _formation_admixture_choice``
------------------------------------------------------------------------

.. CG-BLOCK id=method:SubdivideAllBodies._formation_admixture_choice lines=1659-1678

.. literalinclude:: ../../../src/groundmodel/application/subdivide_all_bodies.py
   :language: python
   :lines: 1659-1678
   :lineno-match:

.. CG-EXPLANATION-START id=method:SubdivideAllBodies._formation_admixture_choice

**What this does.** Reads the engineer's persisted clean-versus-with-admixture
answer from the formation row, or nothing when the unit was never answered.

**Why it is here.** Owner ruling 2026-09-04: for a unit whose admixtures leave the
NAD family ambiguous, the engineer's stored answer forces the family; an unanswered
unit keeps the classifier's automatic behaviour, so nothing changes for units the
prompt never asked about. This is the admixture prompt, which asks only about
clayey or silty admixtures.

.. CG-EXPLANATION-END id=method:SubdivideAllBodies._formation_admixture_choice

