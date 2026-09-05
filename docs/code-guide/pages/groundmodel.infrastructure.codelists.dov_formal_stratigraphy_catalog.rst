groundmodel.infrastructure.codelists.dov_formal_stratigraphy_catalog
====================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/codelists/dov_formal_stratigraphy_catalog.py complete=true

*Source file:* ``src/groundmodel/infrastructure/codelists/dov_formal_stratigraphy_catalog.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/dov_formal_stratigraphy_catalog.py
   :language: python
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the loader for DOV's formal-stratigraphy code table, imports the JSON reader, a caching decorator, the shared key-normaliser and the project logger, and points at the pre-built data file that ships with the app.

**Why it is here.** The docstring states the single question it answers: what is the canonical Dutch name for a DOV formal-stratigraphy code (for example ``"Bm"`` → "Formatie van Boom"). A *catalog* here is a lookup table built ahead of time from DOV's own schema file, so no network is ever needed at runtime. Codes not in the table return nothing, and the caller falls back to showing the raw token — the project rule that raw upstream tokens are kept and only translated at the edge.

.. CG-EXPLANATION-END id=module-header

Class ``FormalStratigraphyEntry``
---------------------------------

.. CG-BLOCK id=class:FormalStratigraphyEntry lines=44-74

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/dov_formal_stratigraphy_catalog.py
   :language: python
   :lines: 44-74
   :lineno-match:

.. CG-EXPLANATION-START id=class:FormalStratigraphyEntry

**What this does.** A frozen data holder for one code: the raw DOV code, its canonical Dutch name, an optional age rank, and an optional colour.

**Why it is here.** A *frozen dataclass* is a small bundle of named values that cannot be changed after it is built. Gathering the four facts about one code in one shape keeps the lookup tidy; the age rank and colour are filled in from the G3Dv3 catalogue where a match exists and left empty otherwise, so the catalogue never invents them.

.. CG-EXPLANATION-END id=class:FormalStratigraphyEntry

Class ``DovFormalStratigraphy`` — header
----------------------------------------

.. CG-BLOCK id=class:DovFormalStratigraphy lines=75-85

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/dov_formal_stratigraphy_catalog.py
   :language: python
   :lines: 75-85
   :lineno-match:

.. CG-EXPLANATION-START id=class:DovFormalStratigraphy

**What this does.** Declares the loader class that reads the code table from its JSON file and builds one index: normalised code to entry.

**Why it is here.** It inherits the project logger because it does work and reports on it. Normalising the code (folding away case, dashes and spaces) means the key the catalogue stores and the key the importer produces are always in the same form, so a lookup cannot miss over a typographic difference.

.. CG-EXPLANATION-END id=class:DovFormalStratigraphy

Method ``DovFormalStratigraphy``. ``def __init__``
--------------------------------------------------

.. CG-BLOCK id=method:DovFormalStratigraphy.__init__ lines=86-125

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/dov_formal_stratigraphy_catalog.py
   :language: python
   :lines: 86-125
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovFormalStratigraphy.__init__

**What this does.** Loads the JSON file, turns every record into an entry, then builds the normalised-code index, keeping the first entry on the rare chance of a clash; it logs how many entries loaded and how many carry a G3Dv3 age rank.

**Why it is here.** Reading and indexing once at start-up makes every later lookup a free dictionary hit. Reusing the shared normaliser is the point recorded in the comment: the catalogue's key and the seeder's key must be identical, or matches would be missed.

.. CG-EXPLANATION-END id=method:DovFormalStratigraphy.__init__

Method ``DovFormalStratigraphy``. ``def resolve``
-------------------------------------------------

.. CG-BLOCK id=method:DovFormalStratigraphy.resolve lines=126-147

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/dov_formal_stratigraphy_catalog.py
   :language: python
   :lines: 126-147
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovFormalStratigraphy.resolve

**What this does.** Returns the entry for an already-normalised code, or nothing when the code is not in the table.

**Why it is here.** The caller normalises the code first; the catalogue key is in the same form. Returning nothing for an unknown code (including DOV's "unknown" marker or an undecomposed compound code) is how the caller knows to fall through to the raw token.

.. CG-EXPLANATION-END id=method:DovFormalStratigraphy.resolve

Method ``DovFormalStratigraphy``. ``def all_entries``
-----------------------------------------------------

.. CG-BLOCK id=method:DovFormalStratigraphy.all_entries lines=148-158

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/dov_formal_stratigraphy_catalog.py
   :language: python
   :lines: 148-158
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovFormalStratigraphy.all_entries

**What this does.** Returns every entry, in the order the schema listed them.

**Why it is here.** Gives callers the whole table (about 403 entries as of the recorded snapshot) when they need to walk it rather than look one code up.

.. CG-EXPLANATION-END id=method:DovFormalStratigraphy.all_entries

Function ``def get_formal_stratigraphy``
----------------------------------------

.. CG-BLOCK id=function:get_formal_stratigraphy lines=159-172

.. literalinclude:: ../../../src/groundmodel/infrastructure/codelists/dov_formal_stratigraphy_catalog.py
   :language: python
   :lines: 159-172
   :lineno-match:

.. CG-EXPLANATION-START id=function:get_formal_stratigraphy

**What this does.** Returns one shared catalogue instance, building it on the first call and returning the same one thereafter.

**Why it is here.** The catalogue is read-only after loading, so one shared copy per program is right. The caching decorator is the lightest way to get that single-shared-instance behaviour without a hand-written guard.

.. CG-EXPLANATION-END id=function:get_formal_stratigraphy

