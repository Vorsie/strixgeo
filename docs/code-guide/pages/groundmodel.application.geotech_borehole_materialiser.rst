groundmodel.application.geotech_borehole_materialiser
=====================================================

.. CG-PAGE source=src/groundmodel/application/geotech_borehole_materialiser.py complete=true

*Source file:* ``src/groundmodel/application/geotech_borehole_materialiser.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-48

.. literalinclude:: ../../../src/groundmodel/application/geotech_borehole_materialiser.py
   :language: python
   :lines: 1-48
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the shared base class that both geotech presses inherit
— "subdivide all bodies" (which cuts CPTs into packing bands) and "divide
boreholes" (which fills borehole columns from mapped neighbours). It gathers the
imports for the domain classifier, the litho digests, the parent-geology
surfaces and the database row types, then declares the shared helpers.

**Why it is here.** A "materialiser" turns an in-memory plan into stored database
rows. The docstring records that both use cases have to find-or-create classified
geotech formations while writing layers, so the shared segment-grouping and
find-or-create logic lives on one base class instead of being copy-pasted (the
project rule: extract on the second copy). It also lists who inherits (the two
use cases) and who does not (dataclasses, value objects, enums, exceptions — they
hold data, not behaviour), which is the project's logging-by-inheritance
convention.

.. CG-EXPLANATION-END id=module-header

Function ``def _canonical_column_id``
-------------------------------------

.. CG-BLOCK id=function:_canonical_column_id lines=49-59

.. literalinclude:: ../../../src/groundmodel/application/geotech_borehole_materialiser.py
   :language: python
   :lines: 49-59
   :lineno-match:

.. CG-EXPLANATION-START id=function:_canonical_column_id

**What this does.** Normalises a column id into the exact ``str(UUID)`` text form
that the digest maps key on; a value that is not a uuid is returned unchanged.

**Why it is here.** The comment states the safe direction: an id that never
matches is still visible in the stamped-versus-banded counts, whereas an id
silently dropped here would simply vanish. Because one mis-cased key would leave a
column unstamped forever and silently — the exact failure the provenance feature
exists to remove — it canonicalises rather than trusts.

.. CG-EXPLANATION-END id=function:_canonical_column_id

Class ``_GeoSurface``
---------------------

.. CG-BLOCK id=class:_GeoSurface lines=60-79

.. literalinclude:: ../../../src/groundmodel/application/geotech_borehole_materialiser.py
   :language: python
   :lines: 60-79
   :lineno-match:

.. CG-EXPLANATION-START id=class:_GeoSurface

**What this does.** A small dataclass that pairs one parent-geology surface (the
cached interpolated mesh) with the geological formation id whose top that surface
is.

**Why it is here.** The ordinary surface loader drops the formation id, but the
geotech builders need it so a cut can be attributed to its geological formation
and matched to a geological contact for provenance. The leading underscore marks
it private to this module.

.. CG-EXPLANATION-END id=class:_GeoSurface

Class ``GeotechBoreholeMaterialiser`` — header
----------------------------------------------

.. CG-BLOCK id=class:GeotechBoreholeMaterialiser lines=80-93

.. literalinclude:: ../../../src/groundmodel/application/geotech_borehole_materialiser.py
   :language: python
   :lines: 80-93
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeotechBoreholeMaterialiser

**What this does.** The base-class header. It inherits the shared logger and
documents that concrete subclasses must pass their own ``__name__`` so log lines
carry the caller's module path.

**Why it is here.** Inheriting ``GroundModelLogger`` is the project convention for
any class with real logic. Making subclasses pass ``__name__`` keeps the log
readable — a line reads as coming from "subdivide all bodies" or "divide
boreholes", not from this base class.

.. CG-EXPLANATION-END id=class:GeotechBoreholeMaterialiser

Method ``GeotechBoreholeMaterialiser``. ``def __init__``
--------------------------------------------------------

.. CG-BLOCK id=method:GeotechBoreholeMaterialiser.__init__ lines=94-111

.. literalinclude:: ../../../src/groundmodel/application/geotech_borehole_materialiser.py
   :language: python
   :lines: 94-111
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechBoreholeMaterialiser.__init__

**What this does.** Stores the session, builds the two repositories it reads
through (litho layers and geology), and starts a counter of the bands this run
left unclassified because their class was foreign to the soil.

**Why it is here.** A "repository" is the object that turns database rows into
Python objects for one table family, keeping the SQL out of the use case. The
counter backs a one-line summary: a per-band WARNING already names each dropped
class, but this lets the press state how many there were, so a run that silently
dropped forty classes cannot read like a clean one (the "log what was NOT found"
discipline).

.. CG-EXPLANATION-END id=method:GeotechBoreholeMaterialiser.__init__

Method ``GeotechBoreholeMaterialiser``. ``def _group_segments``
---------------------------------------------------------------

.. CG-BLOCK id=method:GeotechBoreholeMaterialiser._group_segments lines=112-147

.. literalinclude:: ../../../src/groundmodel/application/geotech_borehole_materialiser.py
   :language: python
   :lines: 112-147
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechBoreholeMaterialiser._group_segments

**What this does.** Groups the litho picks by a pair of keys — which body they
belong to, and which geological unit they sit in — attributing each pick to the
geological unit its midpoint lies in.

**Why it is here.** The picks arrive WHOLE — nothing cuts them at a geological
surface since the owner dropped that wall (2026-08-26). This pass is where the
geological model gets its say, and its say is a LABEL, never a division: a band is
attributed to the unit it mostly lies in, not split by it (the geotech-stage
design note, "what the geological model does instead: it LABELS").

.. CG-EXPLANATION-END id=method:GeotechBoreholeMaterialiser._group_segments

Method ``GeotechBoreholeMaterialiser``. ``async def _ensure_geotech_model``
---------------------------------------------------------------------------

.. CG-BLOCK id=method:GeotechBoreholeMaterialiser._ensure_geotech_model lines=148-212

.. literalinclude:: ../../../src/groundmodel/application/geotech_borehole_materialiser.py
   :language: python
   :lines: 148-212
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechBoreholeMaterialiser._ensure_geotech_model

**What this does.** Finds the single geotechnical child of a litho model or
creates one, and makes sure the model it returns is marked active.

**Why it is here.** Reusing the existing child is what makes a re-build
*idempotent* — running it again produces the same model rather than a duplicate.
Creating a fresh one goes through the repository with the parent kind the
``POST /models`` endpoint normally enforces (a geotechnical model's parent must be
a lithostratigraphic one). The active flag is re-set because the desktop finds the
active geotech model by looking for the active one of that kind, so an inactive
reused model would be invisible after the first build — a defensive-correctness
note in the comment.

.. CG-EXPLANATION-END id=method:GeotechBoreholeMaterialiser._ensure_geotech_model

Method ``GeotechBoreholeMaterialiser``. ``async def _stamp_litho_provenance``
-----------------------------------------------------------------------------

.. CG-BLOCK id=method:GeotechBoreholeMaterialiser._stamp_litho_provenance lines=213-296

.. literalinclude:: ../../../src/groundmodel/application/geotech_borehole_materialiser.py
   :language: python
   :lines: 213-296
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechBoreholeMaterialiser._stamp_litho_provenance

**What this does.** Records, per rebuilt column, a digest (a compact fingerprint)
of the litho stack its bands were made from, folds the new stamps into the model's
stored map, and reports how many banded columns the map now vouches for.

**Why it is here.** This is debt #266's write half (the staleness reader is its
read half). Without it, dragging a litho contact would leave every band in that
column describing a stack that no longer exists — silently, all the way into an
export. It lives on the shared base because both presses must do it identically —
each rebuilds only its own columns and must leave the other's untouched — and two
copies of the fold would drift into two answers about one model. It writes a NEW
dictionary rather than changing the old one in place, because SQLAlchemy does not
notice an in-place change to a JSONB value (a database column holding a JSON
object) and would silently drop the update when the transaction flushes (sends its
queued changes to the database). A rebuilt column with no accepted litho gets the
empty-stack digest, so litho appearing there later reads honestly as a change.

.. CG-EXPLANATION-END id=method:GeotechBoreholeMaterialiser._stamp_litho_provenance

Method ``GeotechBoreholeMaterialiser``. ``async def _load_geo_surfaces_with_formation``
---------------------------------------------------------------------------------------

.. CG-BLOCK id=method:GeotechBoreholeMaterialiser._load_geo_surfaces_with_formation lines=297-338

.. literalinclude:: ../../../src/groundmodel/application/geotech_borehole_materialiser.py
   :language: python
   :lines: 297-338
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechBoreholeMaterialiser._load_geo_surfaces_with_formation

**What this does.** Loads the parent geological model's built, current surfaces —
keeping each one's formation id — and skips any that are stale or carry no
triangles.

**Why it is here.** It keeps the formation id (which the ordinary loader drops) so
a cut can be attributed to its geological formation. A surface with vertices but
no triangles is skipped because it would otherwise silently degrade every lookup
to a nearest-vertex guess — the comment flags this trap. No geological parent
yields an empty list, which labels every pick as the open shallow band.

.. CG-EXPLANATION-END id=method:GeotechBoreholeMaterialiser._load_geo_surfaces_with_formation

Method ``GeotechBoreholeMaterialiser``. ``def _evaluate``
---------------------------------------------------------

.. CG-BLOCK id=method:GeotechBoreholeMaterialiser._evaluate lines=339-351

.. literalinclude:: ../../../src/groundmodel/application/geotech_borehole_materialiser.py
   :language: python
   :lines: 339-351
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechBoreholeMaterialiser._evaluate

**What this does.** Returns the elevation of a surface at a map point, falling back
to the nearest vertex when the point lies off the surface's footprint.

**Why it is here.** It mirrors the pure geo-bounding function's own evaluate, so
the band logic and the pure functions agree exactly. It is a static method — it
needs no instance state.

.. CG-EXPLANATION-END id=method:GeotechBoreholeMaterialiser._evaluate

Method ``GeotechBoreholeMaterialiser``. ``def _make_lowest_boundary_sampler``
-----------------------------------------------------------------------------

.. CG-BLOCK id=method:GeotechBoreholeMaterialiser._make_lowest_boundary_sampler lines=352-363

.. literalinclude:: ../../../src/groundmodel/application/geotech_borehole_materialiser.py
   :language: python
   :lines: 352-363
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechBoreholeMaterialiser._make_lowest_boundary_sampler

**What this does.** Builds a small ready-made function (a closure) that, for a map
point, returns the lowest geological surface elevation there, or nothing when
there are no surfaces.

**Why it is here.** The shallow-test marking needs "how deep does the geology
reach here?" as a sampler it can call with just ``(x, y)``; the closure captures
the surfaces so the caller need not pass them each time.

.. CG-EXPLANATION-END id=method:GeotechBoreholeMaterialiser._make_lowest_boundary_sampler

Method ``GeotechBoreholeMaterialiser``. ``def _geo_formation_at_midpoint``
--------------------------------------------------------------------------

.. CG-BLOCK id=method:GeotechBoreholeMaterialiser._geo_formation_at_midpoint lines=364-408

.. literalinclude:: ../../../src/groundmodel/application/geotech_borehole_materialiser.py
   :language: python
   :lines: 364-408
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechBoreholeMaterialiser._geo_formation_at_midpoint

**What this does.** Answers which geological formation a segment sits in: the
lowest surface still above the segment's midpoint, or nothing — the open shallow
band — when no surface is above it.

**Why it is here.** Reading the MIDPOINT is the thickness-weighted majority rule
(the A2 precedent in docs/domain-model.md): where a surface crosses the segment,
the midpoint lies in whichever side is thicker, exactly. That only started to
matter on 2026-08-26, when the owner dropped the geological wall and segments
became able to straddle a surface at all. The hand-edit writers apply the same
rule over their own written interval, so a re-subdivide cannot relabel a band the
engineer just touched.

.. CG-EXPLANATION-END id=method:GeotechBoreholeMaterialiser._geo_formation_at_midpoint

Method ``GeotechBoreholeMaterialiser``. ``async def _find_or_create_formation``
-------------------------------------------------------------------------------

.. CG-BLOCK id=method:GeotechBoreholeMaterialiser._find_or_create_formation lines=409-492

.. literalinclude:: ../../../src/groundmodel/application/geotech_borehole_materialiser.py
   :language: python
   :lines: 409-492
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechBoreholeMaterialiser._find_or_create_formation

**What this does.** Returns the geotech formation for one sub-unit: a classified
one when the unit has a NAD packing class, a class-less "skeleton" one otherwise —
but first it drops any class that does not belong to the litho unit's own soil
family.

**Why it is here.** Every geotech band in the model is minted through this one
door, so the owner's absolute rule holds here whatever chose the class upstream
(2026-08-26: *"a zand body can never carry a silt packing class"* — *"the NAD
coupling is absolute"*). A foreign class becomes UNCLASSIFIED rather than being
nudged into the right family: a silt's firmness is not evidence about a sand's
density, so inventing a same-rank sand class would dress a guess up as a reading,
which the no-guessing rule forbids (Data Integrity Rule 3). "Not yet classified"
is the honest state, it is visible in the roster, and the engineer can set it by
hand. (The NAD packing class 1–31 itself comes from NBN EN 1997-1 ANB Tabel 2.1,
read on raw cone resistance by decision; the design-ready parameters stay blank.)

.. CG-EXPLANATION-END id=method:GeotechBoreholeMaterialiser._find_or_create_formation

Method ``GeotechBoreholeMaterialiser``. ``async def _find_or_create_classified``
--------------------------------------------------------------------------------

.. CG-BLOCK id=method:GeotechBoreholeMaterialiser._find_or_create_classified lines=493-608

.. literalinclude:: ../../../src/groundmodel/application/geotech_borehole_materialiser.py
   :language: python
   :lines: 493-608
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechBoreholeMaterialiser._find_or_create_classified

**What this does.** Finds or creates the classified geotech formation for one
sub-unit, keyed by the pair (NAD class, litho parent). It checks an in-memory
cache, then the database — taking the OLDEST matching row — and only then mints a
new row copying the litho unit's soil, colour, name and display order.

**Why it is here.** The key is (class, litho parent) because the geological parent
is a LABEL, not identity (owner ruling 2026-08-31, R1, debt #278): one row serves
a class-plus-litho-unit however many geological units the bands straddle, so a
litho unit that crosses a geological boundary keeps ONE row instead of one per
geological band — the "one mass, one body" identity, which also gives one export
class per group. Taking the oldest matching row is the survivor rule the one-time
twin-merge migration applies, so a re-subdivide converges on the row the migration
will keep even before it has run. The geological id is accepted but stored as
``None`` on the row: the band's geological label is derived live from geometry on
read, never frozen here. The ``flush`` after the insert makes the new row's id
available to the caller.

.. CG-EXPLANATION-END id=method:GeotechBoreholeMaterialiser._find_or_create_classified

Method ``GeotechBoreholeMaterialiser``. ``async def _find_or_create_skeleton``
------------------------------------------------------------------------------

.. CG-BLOCK id=method:GeotechBoreholeMaterialiser._find_or_create_skeleton lines=609-710

.. literalinclude:: ../../../src/groundmodel/application/geotech_borehole_materialiser.py
   :language: python
   :lines: 609-710
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechBoreholeMaterialiser._find_or_create_skeleton

**What this does.** The same find-or-create, but for a class-less "skeleton"
formation, keyed only by the litho parent.

**Why it is here.** Skeletons are used for borehole-only sub-bodies in a CPT-free
body (which can never be TIN-divided) and as a last resort when the model holds no
CPT data at all. The same R1 rule applies: the geological parent is a label, one
row per litho parent, oldest matching row wins. Because a skeleton has no class,
two of them are never judged equal by class — the litho parent alone is the key.

.. CG-EXPLANATION-END id=method:GeotechBoreholeMaterialiser._find_or_create_skeleton

Method ``GeotechBoreholeMaterialiser``. ``async def _source_litho_soil_code``
-----------------------------------------------------------------------------

.. CG-BLOCK id=method:GeotechBoreholeMaterialiser._source_litho_soil_code lines=711-738

.. literalinclude:: ../../../src/groundmodel/application/geotech_borehole_materialiser.py
   :language: python
   :lines: 711-738
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechBoreholeMaterialiser._source_litho_soil_code

**What this does.** Returns the main soil of the litho unit a geotech band
subdivides.

**Why it is here.** This is exactly what the soil-family clamp judges a class
against. The row is almost always already loaded in the session's identity map —
SQLAlchemy's in-memory cache of rows already read, so asking again is free — since
the caller has just grouped by it, making this a dictionary hit rather than a
query per band. A missing row or missing soil returns nothing, and the clamp then
stays silent: with no family there is nothing to judge a class against.

.. CG-EXPLANATION-END id=method:GeotechBoreholeMaterialiser._source_litho_soil_code

Method ``GeotechBoreholeMaterialiser``. ``async def _resolve_anchor_kinds``
---------------------------------------------------------------------------

.. CG-BLOCK id=method:GeotechBoreholeMaterialiser._resolve_anchor_kinds lines=739-767

.. literalinclude:: ../../../src/groundmodel/application/geotech_borehole_materialiser.py
   :language: python
   :lines: 739-767
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeotechBoreholeMaterialiser._resolve_anchor_kinds

**What this does.** Labels each investigation id as either ``"borehole"`` or
``"cpt"`` by looking it up in both tables.

**Why it is here.** The band planners need to know which columns are boreholes
(whose bands are extrapolated, and which therefore refuse the hand-edit verbs) and
which are CPTs (measured). Two small queries answer it, keyed by the id as text to
match the rest of the module.

.. CG-EXPLANATION-END id=method:GeotechBoreholeMaterialiser._resolve_anchor_kinds

