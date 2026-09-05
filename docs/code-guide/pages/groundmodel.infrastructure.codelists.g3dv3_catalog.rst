groundmodel.infrastructure.codelists.g3dv3_catalog
==================================================

.. CG-PAGE source=src/groundmodel/infrastructure/codelists/g3dv3_catalog.py complete=true

*Source file:* ``src/groundmodel/infrastructure/codelists/g3dv3_catalog.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-56

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/g3dv3_catalog.py
   :language: python
   :lines: 1-56
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the loader for the G3Dv3 stratigraphic catalogue — the canonical list of Flanders geological units — imports the JSON reader, a caching decorator and the project logger, and points at the pre-built unit file and its alias file.

**Why it is here.** The docstring records the two questions it answers: is one unit older than another (every unit carries an integer age rank), and what is a unit's prescribed colour. It also draws the boundary with the DOV formal-stratigraphy catalogue: the Dutch name is the reliable join key here because manually-entered formation names ("Boom", "Diest") match this catalogue's short model names directly, whereas DOV's permkey codes belong to the other catalogue. Everything ships with the app, so no network is needed at runtime.

.. CG-EXPLANATION-END id=module-header

Class ``G3Dv3Unit``
-------------------

.. CG-BLOCK id=class:G3Dv3Unit lines=57-102

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/g3dv3_catalog.py
   :language: python
   :lines: 57-102
   :lineno-match:

.. CG-EXPLANATION-START id=class:G3Dv3Unit

**What this does.** A frozen data holder for one geological unit: its numeric code, abbreviation, rank (formation or member), parent, Dutch name, age rank, prescribed colour, and three hydrogeology codes carried for future use.

**Why it is here.** It is a *frozen dataclass* — a small named bundle that cannot be changed after creation. The docstring records the key convention it serves: age rank runs 0 for the youngest unit to 116 for the oldest, and to set a formation's on-screen order (where lower means older) the sign is inverted. The hydrogeology fields are stored now but unused in v1.

.. CG-EXPLANATION-END id=class:G3Dv3Unit

Function ``def _normalize``
---------------------------

.. CG-BLOCK id=function:_normalize lines=103-125

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/g3dv3_catalog.py
   :language: python
   :lines: 103-125
   :lineno-match:

.. CG-EXPLANATION-START id=function:_normalize

**What this does.** Lowercases a name and collapses its runs of whitespace to single spaces, returning an empty string for a missing name.

**Why it is here.** Names arrive with inconsistent casing and stray spaces on both sides — the DOV descriptions, the engineer's typing, and even one catalogue entry with a trailing space. Reducing both sides to one normal form makes the lookup treat "Boom", "boom" and " Boom " as the same.

.. CG-EXPLANATION-END id=function:_normalize

Class ``G3Dv3Catalog`` — header
-------------------------------

.. CG-BLOCK id=class:G3Dv3Catalog lines=126-138

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/g3dv3_catalog.py
   :language: python
   :lines: 126-138
   :lineno-match:

.. CG-EXPLANATION-START id=class:G3Dv3Catalog

**What this does.** Declares the catalogue loader that reads the units from JSON and builds three indexes: by normalised name, by normalised abbreviation, and by exact code.

**Why it is here.** It inherits the project logger because it does work and reports on it. Three indexes let a caller look a unit up by whichever form it holds. It is meant to be shared as one instance per program, vended by the accessor at the foot of the file.

.. CG-EXPLANATION-END id=class:G3Dv3Catalog

Method ``G3Dv3Catalog``. ``def __init__``
-----------------------------------------

.. CG-BLOCK id=method:G3Dv3Catalog.__init__ lines=139-190

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/g3dv3_catalog.py
   :language: python
   :lines: 139-190
   :lineno-match:

.. CG-EXPLANATION-START id=method:G3Dv3Catalog.__init__

**What this does.** Loads the unit JSON into the three indexes, then loads the alias file (normalising both sides of each alias), and logs how many units, formations, members and aliases were read.

**Why it is here.** Reading and indexing once at start-up makes every later lookup free. Aliases are kept as a separate data file so a historical formation name can be added with a one-line change rather than a code commit, which the docstring notes is expected to happen with every older interpretation campaign.

.. CG-EXPLANATION-END id=method:G3Dv3Catalog.__init__

Method ``G3Dv3Catalog``. ``def all_units``
------------------------------------------

.. CG-BLOCK id=method:G3Dv3Catalog.all_units lines=191-194

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/g3dv3_catalog.py
   :language: python
   :lines: 191-194
   :lineno-match:

.. CG-EXPLANATION-START id=method:G3Dv3Catalog.all_units

**What this does.** Returns every unit, in age order (youngest first).

**Why it is here.** Gives callers the whole ordered list when they need to walk it rather than look one unit up.

.. CG-EXPLANATION-END id=method:G3Dv3Catalog.all_units

Method ``G3Dv3Catalog``. ``def lookup_by_name``
-----------------------------------------------

.. CG-BLOCK id=method:G3Dv3Catalog.lookup_by_name lines=195-211

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/g3dv3_catalog.py
   :language: python
   :lines: 195-211
   :lineno-match:

.. CG-EXPLANATION-START id=method:G3Dv3Catalog.lookup_by_name

**What this does.** Matches a unit by its Dutch name (case- and whitespace-insensitive), and if the direct name misses, tries the alias table before giving up.

**Why it is here.** The alias fall-through is what lets a borehole logged under an older name ("Ieper", "Ieperiaan") resolve to the modern catalogue entry ("Kortrijk").

.. CG-EXPLANATION-END id=method:G3Dv3Catalog.lookup_by_name

Method ``G3Dv3Catalog``. ``def lookup_by_abbreviation``
-------------------------------------------------------

.. CG-BLOCK id=method:G3Dv3Catalog.lookup_by_abbreviation lines=212-215

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/g3dv3_catalog.py
   :language: python
   :lines: 212-215
   :lineno-match:

.. CG-EXPLANATION-START id=method:G3Dv3Catalog.lookup_by_abbreviation

**What this does.** Matches a unit by its G3D abbreviation, case-insensitively.

**Why it is here.** A second way in, for callers holding the abbreviation rather than the name.

.. CG-EXPLANATION-END id=method:G3Dv3Catalog.lookup_by_abbreviation

Method ``G3Dv3Catalog``. ``def lookup_by_code``
-----------------------------------------------

.. CG-BLOCK id=method:G3Dv3Catalog.lookup_by_code lines=216-221

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/g3dv3_catalog.py
   :language: python
   :lines: 216-221
   :lineno-match:

.. CG-EXPLANATION-START id=method:G3Dv3Catalog.lookup_by_code

**What this does.** Matches a unit by its exact numeric G3D code, returning nothing for a missing code.

**Why it is here.** Codes are structural and numeric, so they are matched exactly with no normalisation.

.. CG-EXPLANATION-END id=method:G3Dv3Catalog.lookup_by_code

Method ``G3Dv3Catalog``. ``def resolve``
----------------------------------------

.. CG-BLOCK id=method:G3Dv3Catalog.resolve lines=222-236

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/g3dv3_catalog.py
   :language: python
   :lines: 222-236
   :lineno-match:

.. CG-EXPLANATION-START id=method:G3Dv3Catalog.resolve

**What this does.** Tries name, then abbreviation, then code, and returns the first match or nothing.

**Why it is here.** For callers holding an engineer-supplied or DOV-derived string of unknown form; trying the three indexes in order means the caller need not know which kind of token it has.

.. CG-EXPLANATION-END id=method:G3Dv3Catalog.resolve

Method ``G3Dv3Catalog``. ``def display_order_for``
--------------------------------------------------

.. CG-BLOCK id=method:G3Dv3Catalog.display_order_for lines=237-252

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/g3dv3_catalog.py
   :language: python
   :lines: 237-252
   :lineno-match:

.. CG-EXPLANATION-START id=method:G3Dv3Catalog.display_order_for

**What this does.** Resolves a token to a unit and returns its on-screen order as the negated age rank, or nothing when the token does not resolve.

**Why it is here.** The project convention is that a lower on-screen order means older, but the catalogue's age rank runs the other way, so this helper flips the sign once so callers need not remember it. Returning nothing lets a caller fall back to its own ordering (usually depth-derived) for an unrecognised unit.

.. CG-EXPLANATION-END id=method:G3Dv3Catalog.display_order_for

Function ``def get_catalog``
----------------------------

.. CG-BLOCK id=function:get_catalog lines=253-261

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/g3dv3_catalog.py
   :language: python
   :lines: 253-261
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_catalog

**What this does.** Returns one shared catalogue instance, building it on the first call and returning the same one thereafter.

**Why it is here.** The catalogue is read-only after loading, so one shared copy per program is right; the caching decorator is the lightest way to get that single-shared-instance behaviour.

.. CG-EXPLANATION-END id=function:get_catalog

