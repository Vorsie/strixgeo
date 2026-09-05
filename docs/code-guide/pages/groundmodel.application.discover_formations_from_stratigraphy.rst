groundmodel.application.discover_formations_from_stratigraphy
=============================================================

.. CG-PAGE source=src/groundmodel/application/discover_formations_from_stratigraphy.py complete=true

*Source file:* ``src/groundmodel/application/discover_formations_from_stratigraphy.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../src/groundmodel/application/discover_formations_from_stratigraphy.py
   :language: python
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring and imports for a read-only use case that backs the "discover formations from stratigraphy" web address. It pulls in the shared scan helper and the two data holders (candidate and collision).

**Why it is here.** This is the preview half of the Seed/Fill flow: it scans the same streams the writer walks but touches nothing in the database, feeding the dialog where the engineer curates which formations to keep before any change is committed.

.. CG-EXPLANATION-END id=module-header

Class ``DiscoverFormationsFromStratigraphy`` — header
-----------------------------------------------------

.. CG-BLOCK id=class:DiscoverFormationsFromStratigraphy lines=26-32

.. literalinclude:: ../../../src/groundmodel/application/discover_formations_from_stratigraphy.py
   :language: python
   :lines: 26-32
   :lineno-match:

.. CG-EXPLANATION-START id=class:DiscoverFormationsFromStratigraphy

**What this does.** The read-only use-case class. Its summary states plainly that it scans boreholes and returns candidate formation names with no transaction, no flush, and no commit.

**Why it is here.** A pure read path needs no commit, so callers do not have to commit the session afterwards. Saying so on the class is a signal to every caller.

.. CG-EXPLANATION-END id=class:DiscoverFormationsFromStratigraphy

Method ``DiscoverFormationsFromStratigraphy``. ``def __init__``
---------------------------------------------------------------

.. CG-BLOCK id=method:DiscoverFormationsFromStratigraphy.__init__ lines=33-43

.. literalinclude:: ../../../src/groundmodel/application/discover_formations_from_stratigraphy.py
   :language: python
   :lines: 33-43
   :lineno-match:

.. CG-EXPLANATION-START id=method:DiscoverFormationsFromStratigraphy.__init__

**What this does.** Stores the database session, used only for read queries.

**Why it is here.** The session is supplied by the caller; this class only reads through it.

.. CG-EXPLANATION-END id=method:DiscoverFormationsFromStratigraphy.__init__

Method ``DiscoverFormationsFromStratigraphy``. ``async def execute``
--------------------------------------------------------------------

.. CG-BLOCK id=method:DiscoverFormationsFromStratigraphy.execute lines=44-112

.. literalinclude:: ../../../src/groundmodel/application/discover_formations_from_stratigraphy.py
   :language: python
   :lines: 44-112
   :lineno-match:

.. CG-EXPLANATION-START id=method:DiscoverFormationsFromStratigraphy.execute

**What this does.** Turns the borehole ids into a list, logs what it received, hands the whole scan to the shared ``scan_stratigraphy_candidates`` helper (passing the same lumping map and formal-to-informal bridge the write path will use), logs the result, and returns the pair of (candidates, collisions).

**Why it is here.** It delegates rather than duplicating the walk so the discover preview and the write path are provably identical — the discover-equals-apply-equals-seed invariant the docstring names. The caller must send the same lumping map and bridge to both endpoints for that guarantee to hold; the project scope is passed so borehole ids from another project are filtered out.

.. CG-EXPLANATION-END id=method:DiscoverFormationsFromStratigraphy.execute

