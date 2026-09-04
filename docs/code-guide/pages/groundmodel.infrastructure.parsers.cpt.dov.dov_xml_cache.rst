groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache
========================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/cpt/dov/dov_xml_cache.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/cpt/dov/dov_xml_cache.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-49

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_xml_cache.py
   :language: python
   :lines: 1-49
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring describing an on-disk cache for downloaded DOV XML files, plus two tuning constants: how often to check the cache size, and how far below the size cap to sweep when it is over.

**Why it is here.** DOV data is historical — once a CPT is measured its XML never changes — so a region downloaded once can be served from disk forever, making a repeat import over the same area near-instant. A *permkey* is DOV's permanent identifier for one record; the cache stores one file per permkey, so the filename itself is the key and no separate index is needed. The whole cache is a pure speed optimisation: every operation falls back to the network on any disk error and never blocks an import.

.. CG-EXPLANATION-END id=module-header

Class ``DovXmlCache`` — header
------------------------------

.. CG-BLOCK id=class:DovXmlCache lines=50-66

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_xml_cache.py
   :language: python
   :lines: 50-66
   :lineno-match:

.. CG-EXPLANATION-START id=class:DovXmlCache

**What this does.** Opens the cache class and documents its two settings: the folder to store files in, and an optional soft size cap above which the oldest files are deleted.

**Why it is here.** A cache that grew forever would eventually fill the user's disk, so the size cap and the oldest-first eviction exist to bound it. Leaving the cap unset disables eviction, which is the historic behaviour and handy in tests.

.. CG-EXPLANATION-END id=class:DovXmlCache

Method ``DovXmlCache``. ``def __init__``
----------------------------------------

.. CG-BLOCK id=method:DovXmlCache.__init__ lines=67-91

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_xml_cache.py
   :language: python
   :lines: 67-91
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovXmlCache.__init__

**What this does.** Sets up the cache: remembers the folder and the size cap, tries to create the folder, and — if a cap is set — runs one clean-up sweep at start-up. If the folder cannot be created it logs a warning and quietly disables the cache for the session.

**Why it is here.** A cache that cannot make its folder must not stop the app — every read then simply misses and every write is a no-op, so the import transparently uses the network. The start-up sweep matters because the "writes since last check" counter resets each launch; without it, many short sessions could each write a few files and let the cache drift past its ceiling forever.

.. CG-EXPLANATION-END id=method:DovXmlCache.__init__

Method ``DovXmlCache``. ``def get``
-----------------------------------

.. CG-BLOCK id=method:DovXmlCache.get lines=92-104

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_xml_cache.py
   :language: python
   :lines: 92-104
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovXmlCache.get

**What this does.** Returns the cached bytes for a permkey, or "nothing" on a miss or any read error.

**Why it is here.** This is the fast path the download step checks first. Treating a read error the same as a miss keeps the rule that a cache problem never breaks an import — it just falls through to the network.

.. CG-EXPLANATION-END id=method:DovXmlCache.get

Method ``DovXmlCache``. ``def put``
-----------------------------------

.. CG-BLOCK id=method:DovXmlCache.put lines=105-140

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_xml_cache.py
   :language: python
   :lines: 105-140
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovXmlCache.put

**What this does.** Writes the XML for a permkey to the cache safely: it writes to a temporary file, forces the bytes all the way to disk, then renames the temporary file into place. Any failure is logged, the temporary file is cleaned up, and the method returns without raising. Every so often it also triggers a size-check sweep.

**Why it is here.** The write-then-rename dance is for crash safety: a half-written ``.xml`` would later parse as broken XML and confuse the import, and forcing the data to disk *before* the rename means the rename can only ever publish a fully-written file, even if the machine loses power at the worst moment.

.. CG-EXPLANATION-END id=method:DovXmlCache.put

Method ``DovXmlCache``. ``def delete``
--------------------------------------

.. CG-BLOCK id=method:DovXmlCache.delete lines=141-158

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_xml_cache.py
   :language: python
   :lines: 141-158
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovXmlCache.delete

**What this does.** Removes one cached entry, doing nothing if it is already gone, and never raising on failure.

**Why it is here.** It is used to throw away a cached XML that will not parse, so a single fresh download can replace it instead of the same broken bytes being re-read on every future import. A failed delete just leaves the entry to be retried next time.

.. CG-EXPLANATION-END id=method:DovXmlCache.delete

Method ``DovXmlCache``. ``def _path_for``
-----------------------------------------

.. CG-BLOCK id=method:DovXmlCache._path_for lines=159-165

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_xml_cache.py
   :language: python
   :lines: 159-165
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovXmlCache._path_for

**What this does.** Works out the file path for a permkey, but first checks the permkey against a strict pattern and refuses (returning "nothing") if it looks unsafe.

**Why it is here.** The permkey comes from data DOV sent, so it is not fully trusted. Checking it against a fixed pattern before it becomes a filename stops a malformed value from being used to reach outside the cache folder.

.. CG-EXPLANATION-END id=method:DovXmlCache._path_for

Method ``DovXmlCache``. ``def _maybe_evict``
--------------------------------------------

.. CG-BLOCK id=method:DovXmlCache._maybe_evict lines=166-213

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/cpt/dov/dov_xml_cache.py
   :language: python
   :lines: 166-213
   :lineno-match:

.. CG-EXPLANATION-START id=method:DovXmlCache._maybe_evict

**What this does.** When a size cap is set, totals the cache folder and, if it is over the cap, deletes files oldest-first until it drops a little below the cap. It only touches ``.xml`` files it owns, and every step tolerates an error so a failed sweep never breaks an import.

**Why it is here.** This is what actually bounds the cache's disk use. Sweeping to slightly below the cap leaves headroom so the next write does not immediately trigger another sweep. It runs inline on the writing task, which is safe because DOV imports already take turns on the network and the sweep only touches the app's own files.

.. CG-EXPLANATION-END id=method:DovXmlCache._maybe_evict

