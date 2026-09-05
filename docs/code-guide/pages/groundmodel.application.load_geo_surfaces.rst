groundmodel.application.load_geo_surfaces
=========================================

.. CG-PAGE source=src/groundmodel/application/load_geo_surfaces.py complete=true

*Source file:* ``src/groundmodel/application/load_geo_surfaces.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../src/groundmodel/application/load_geo_surfaces.py
   :language: python
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening docstring and imports of a shared helper module. The docstring says it reads a parent geological model's built surfaces and wraps each usable one as a bound the 3-D voxel builder can use, and that it also carries a digest function that lets a surface rebuild bust the 3-D cache; the imports bring in the hashing and byte-packing libraries, the session type, the surface-bound domain type, the triangulated-surface value object, and the geology repository.

**Why it is here.** The docstring records who consumes it — the voxel builder bounds its labelled grid by these surfaces — and two design points. The load function takes an optional logger so a caller can pass itself to keep its own log lines, and returns a tuple, the exact shape the downstream helpers expect. The digest exists so that a geo-surface rebuild changes the build checksum and forces a fresh litho 3-D build rather than reusing a stale cache.

.. CG-EXPLANATION-END id=module-header

Function ``async def load_geo_surfaces``
----------------------------------------

.. CG-BLOCK id=function:load_geo_surfaces lines=34-87

.. literalinclude:: ../../../src/groundmodel/application/load_geo_surfaces.py
   :language: python
   :lines: 34-87
   :lineno-match:

.. CG-EXPLANATION-START id=function:load_geo_surfaces

**What this does.** An async function that reads the parent geological model's surface rows, skips any that are stale (not yet rebuilt) or have no geometry, wraps each remaining surface as a bound, optionally logs the skip reasons and a summary, and returns the bounds as a tuple.

**Why it is here.** It gives the voxel builder only usable surfaces to bound its grid by, so a half-built or empty surface never distorts the 3-D result. Stale means the surface no longer matches its contacts and must be rebuilt before it is trusted; skipping such rows is the safe choice. The optional logger keeps the per-surface skip reasons visible in a dogfeed log without a debugger, following the log-what-was-not-found rule.

.. CG-EXPLANATION-END id=function:load_geo_surfaces

Function ``def digest_surfaces``
--------------------------------

.. CG-BLOCK id=function:digest_surfaces lines=88-129

.. literalinclude:: ../../../src/groundmodel/application/load_geo_surfaces.py
   :language: python
   :lines: 88-129
   :lineno-match:

.. CG-EXPLANATION-START id=function:digest_surfaces

**What this does.** A pure function that computes a short 16-byte fingerprint (a BLAKE2b digest — a fixed-length summary that changes if any input byte changes) of the surfaces' mesh geometry, folding in every vertex and triangle in a deterministic sorted order.

**Why it is here.** The digest is folded into the litho 3-D build checksum so any change to the geological surfaces forces a rebuild rather than reusing a cached solid. The comment explains the sort must include the elevation as a third key: two flat surfaces tiling the same footprint at different heights would otherwise sort by database load order, letting the digest drift with no data change and cause a false cache-skip or a false rebuild.

.. CG-EXPLANATION-END id=function:digest_surfaces

