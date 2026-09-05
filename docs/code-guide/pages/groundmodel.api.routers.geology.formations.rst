groundmodel.api.routers.geology.formations
==========================================

.. CG-PAGE source=src/groundmodel/api/routers/geology/formations.py complete=true

*Source file:* ``src/groundmodel/api/routers/geology/formations.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-57

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/formations.py
   :language: python
   :lines: 1-57
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file (formation routes) and imports the router tools, the scope guard, the formation and codelist schemas, the NAD-classification helpers, the DOV formal-stratigraphy catalog, the formation database row and repository, the lithology/admixture/NAD constants, and the logger. It makes a module-level logger and a bare, prefix-less router.

**Why it is here.** Same split-package pattern as the other geology sub-routers (debt #40): mounted under the shared geology prefix by the package ``__init__``; module-level logger because routers are functions. A *formation* here is a named geological (or lithostratigraphic, or geotechnical) unit in the project's catalogue.

.. CG-EXPLANATION-END id=module-header

Function ``def _build_parent_name_map``
---------------------------------------

.. CG-BLOCK id=function:_build_parent_name_map lines=58-81

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/formations.py
   :language: python
   :lines: 58-81
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_parent_name_map

**What this does.** A private helper that builds a lookup from formation id to formation name out of an already-loaded list of formations.

**Why it is here.** It resolves a child unit's parent name without a second database trip or walking a database relationship. In this async setup, following a relationship lazily from inside the response serialiser raises an error (``MissingGreenlet``), so the parent name is resolved from data already in memory instead. It is a pure in-memory pass.

.. CG-EXPLANATION-END id=function:_build_parent_name_map

Function ``def _resolve_formal_code``
-------------------------------------

.. CG-BLOCK id=function:_resolve_formal_code lines=82-116

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/formations.py
   :language: python
   :lines: 82-116
   :lineno-match:

.. CG-EXPLANATION-START id=function:_resolve_formal_code

**What this does.** A private helper that works out a formation's official DOV formal-stratigraphy code, preferring an explicit manual code, then a formal reference canonicalised through the DOV lexicon, and otherwise nothing.

**Why it is here.** The formal code drives the automatic name of a lens (parent code plus lithology abbreviation plus depth rank, e.g. QPSa1). The precedence puts the engineer's manual link first as the authoritative override, then the code stored by the fill-from-boreholes flow, normalising case and whitespace variants to the official token so equivalent spellings collapse to one code.

.. CG-EXPLANATION-END id=function:_resolve_formal_code

Function ``def _build_parent_code_map``
---------------------------------------

.. CG-BLOCK id=function:_build_parent_code_map lines=117-140

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/formations.py
   :language: python
   :lines: 117-140
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_parent_code_map

**What this does.** A private helper that builds a lookup from formation id to resolved formal code, mirroring the name map above and using the code resolver for each formation.

**Why it is here.** Same reason as the name map: it feeds the lens auto-name without any relationship traversal, resolving every project formation's code in one in-memory pass; the formal catalog it consults is a single shared object loaded once per process.

.. CG-EXPLANATION-END id=function:_build_parent_code_map

Function ``def _enrich_formation``
----------------------------------

.. CG-BLOCK id=function:_enrich_formation lines=141-180

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/formations.py
   :language: python
   :lines: 141-180
   :lineno-match:

.. CG-EXPLANATION-START id=function:_enrich_formation

**What this does.** A private helper that turns one formation database row into its response schema and then fills in the parent's name (and, when a code map is given, the parent's formal code) from the pre-built lookups.

**Why it is here.** It uses the schema's read-from-row facility to copy every stored field, then injects the two derived parent fields without following a database relationship (which would fail on the async session). It defends against an orphan whose parent was deleted by returning nothing for the parent name rather than raising.

.. CG-EXPLANATION-END id=function:_enrich_formation

Function ``def _enrich_formation_list``
---------------------------------------

.. CG-BLOCK id=function:_enrich_formation_list lines=181-211

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/formations.py
   :language: python
   :lines: 181-211
   :lineno-match:

.. CG-EXPLANATION-START id=function:_enrich_formation_list

**What this does.** A private helper that enriches a whole list of formation rows: it builds the name and code maps from the same list, then enriches each row.

**Why it is here.** The parent of any formation is always present in the same project-scoped list, so both maps can be built once and reused, giving a single linear pass over the formations rather than a lookup per row.

.. CG-EXPLANATION-END id=function:_enrich_formation_list

Function ``async def create_formation``
---------------------------------------

.. CG-BLOCK id=function:create_formation lines=212-275

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/formations.py
   :language: python
   :lines: 212-275
   :lineno-match:

.. CG-EXPLANATION-START id=function:create_formation

**What this does.** The handler for ``POST .../formations`` — create a new formation under the project (only the name is required). It can also create a lithostratigraphic child by passing a parent id, main soil code, and optional admixtures. It creates the row, commits, and returns it with its parent name resolved as ``201 Created``.

**Why it is here.** The child-without-a-contact path exists for the "Add new unit" ghost flow (dogfeed 2026-05-26): the desktop creates the formation first, then the engineer drags the contact into place through the normal accept flow, so no placeholder sentinel contact is created. Supplying the soil code and admixtures lets a later re-use of the same unit match the find-or-create key.

.. CG-EXPLANATION-END id=function:create_formation

Function ``async def list_formations``
--------------------------------------

.. CG-BLOCK id=function:list_formations lines=276-300

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/formations.py
   :language: python
   :lines: 276-300
   :lineno-match:

.. CG-EXPLANATION-START id=function:list_formations

**What this does.** The handler for ``GET .../formations`` — list every formation in the project, ordered by display order then name, each with its parent name resolved.

**Why it is here.** A read scoped by the project in the path. The display-order-then-name sort is the stratigraphic order the desktop shows; the parent names are resolved from the same list without extra queries.

.. CG-EXPLANATION-END id=function:list_formations

Function ``async def formation_codelist``
-----------------------------------------

.. CG-BLOCK id=function:formation_codelist lines=301-366

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/formations.py
   :language: python
   :lines: 301-366
   :lineno-match:

.. CG-EXPLANATION-START id=function:formation_codelist

**What this does.** The handler for ``GET .../formations/codelist`` — return the suggestion vocabulary appropriate to the model kind: lithology labels and admixtures for a litho model, plus the NAD packing-class options for a geotech model, and nothing fixed for a geological model.

**Why it is here.** It feeds the editor's autocomplete only — the create endpoint stays permissive so it never blocks a real value. It is declared before the dynamic by-id routes so the fixed ``codelist`` segment is matched first, and the vocabulary is project-independent so it needs no project lookup. The NAD classes come from the published packing-class table (Belgian national annex NBN EN 1997-1 ANB Tabel 2.1). Raw tokens are coerced to plain strings only to satisfy the response schema's types.

.. CG-EXPLANATION-END id=function:formation_codelist

Function ``async def update_formation``
---------------------------------------

.. CG-BLOCK id=function:update_formation lines=367-439

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/formations.py
   :language: python
   :lines: 367-439
   :lineno-match:

.. CG-EXPLANATION-START id=function:update_formation

**What this does.** The handler for ``PATCH .../formations/{formation_id}`` — partially update a formation. It runs the scope guard, applies only the fields the body set, refuses with ``422`` a packing class that does not match the unit's soil, commits, and returns the enriched row.

**Why it is here.** Scope-guarded before the write so a leaked id from another project cannot mutate a row (cross-project id-enumeration guard). The soil-versus-class check enforces an absolute coupling (owner ruling 2026-08-26): a NAD packing class describes exactly one soil column and is never valid on another, so a PATCH that would put a mismatched class on a unit is refused ``422`` with a message naming the correct soil family. A partial update leaves omitted fields untouched.

.. CG-EXPLANATION-END id=function:update_formation

Function ``async def delete_formation``
---------------------------------------

.. CG-BLOCK id=function:delete_formation lines=440-472

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/formations.py
   :language: python
   :lines: 440-472
   :lineno-match:

.. CG-EXPLANATION-START id=function:delete_formation

**What this does.** The handler for ``DELETE .../formations/{formation_id}`` — delete a formation. It runs the scope guard, deletes (cascading to every contact that referenced it), commits, and answers ``204 No Content``.

**Why it is here.** Scope-guarded like the update. Deleting a formation cascades to its contacts because a contact only means something as "where this formation begins", so an orphaned contact would be meaningless.

.. CG-EXPLANATION-END id=function:delete_formation

