groundmodel.api.heavy_library_warmup
====================================

.. CG-PAGE source=src/groundmodel/api/heavy_library_warmup.py complete=true

*Source file:* ``src/groundmodel/api/heavy_library_warmup.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-55

.. literalinclude:: ../../../src/groundmodel/api/heavy_library_warmup.py
   :language: python
   :lines: 1-55
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a background "warm-up" that loads the heavy
libraries *after* the app is already up and answering. It imports only light
things at the top; every heavy import is tucked inside a function further down,
run only on the background thread.

**Why it is here.** To keep the app quick to start, the boot path deliberately
does **not** load the biggest libraries — the voxel-mesh JIT (numba), the
D-Series exporters (geolib), the DXF exporter (ezdxf), the surface maths (scipy).
They load on first use instead. But that only moves the delay onto the user's
first export or first 3-D Build. The owner's fix (4 September 2026): "just
install the heavy libraries in the background when the app is open." So once the
engine is READY, this quietly loads them on a side thread, so the first real
action pays neither the import nor the compile. A *thread* is a second line of
work running alongside the main one.

.. CG-EXPLANATION-END id=module-header

Function ``def _import_numba``
------------------------------

.. CG-BLOCK id=function:_import_numba lines=56-61

.. literalinclude:: ../../../src/groundmodel/api/heavy_library_warmup.py
   :language: python
   :lines: 56-61
   :lineno-match:

.. CG-EXPLANATION-START id=function:_import_numba

**What this does.** Loads numba and its compiler backend (llvmlite). These are
the just-in-time compiler behind the 3-D voxel-mesh step.

**Why it is here.** It is one warm-up step, kept as its own function so it can be
timed and so a failure in it does not stop the others. The ``# noqa`` comments
tell the linter "yes, this import looks unused — it is here for its side effect
of loading, on purpose".

.. CG-EXPLANATION-END id=function:_import_numba

Function ``def _import_geolib``
-------------------------------

.. CG-BLOCK id=function:_import_geolib lines=62-66

.. literalinclude:: ../../../src/groundmodel/api/heavy_library_warmup.py
   :language: python
   :lines: 62-66
   :lineno-match:

.. CG-EXPLANATION-START id=function:_import_geolib

**What this does.** Loads GEOLib — the library behind the D-Stability and
D-Sheet Piling exports (it also drags in matplotlib).

**Why it is here.** Same reason as the others: pre-load it now, on the side, so
the first D-Series export does not pay the load cost.

.. CG-EXPLANATION-END id=function:_import_geolib

Function ``def _import_ezdxf``
------------------------------

.. CG-BLOCK id=function:_import_ezdxf lines=67-71

.. literalinclude:: ../../../src/groundmodel/api/heavy_library_warmup.py
   :language: python
   :lines: 67-71
   :lineno-match:

.. CG-EXPLANATION-START id=function:_import_ezdxf

**What this does.** Loads ezdxf, the library that writes DXF drawing files for
the section and fence exports.

**Why it is here.** Pre-loaded in the background so the first DXF export is
instant rather than waiting on the import.

.. CG-EXPLANATION-END id=function:_import_ezdxf

Function ``def _import_scipy_spatial``
--------------------------------------

.. CG-BLOCK id=function:_import_scipy_spatial lines=72-76

.. literalinclude:: ../../../src/groundmodel/api/heavy_library_warmup.py
   :language: python
   :lines: 72-76
   :lineno-match:

.. CG-EXPLANATION-START id=function:_import_scipy_spatial

**What this does.** Loads ``scipy.spatial`` — the maths used to triangulate
ground surfaces (the TIN).

**Why it is here.** Pre-loaded in the background so the first surface build does
not stall on it.

.. CG-EXPLANATION-END id=function:_import_scipy_spatial

Function ``def _compile_mesh_kernel``
-------------------------------------

.. CG-BLOCK id=function:_compile_mesh_kernel lines=77-99

.. literalinclude:: ../../../src/groundmodel/api/heavy_library_warmup.py
   :language: python
   :lines: 77-99
   :lineno-match:

.. CG-EXPLANATION-START id=function:_compile_mesh_kernel

**What this does.** Actually runs the voxel-mesh compiled kernel once, on a
1×1 dummy grid.

**Why it is here.** numba compiles a function the first time it is *called*, not
when it is loaded — and that compile costs about 0.6 seconds. Calling it here on
a trivial input pays that compile now, in the background, instead of on the
user's first real 3-D Build. Because the compiled result is cached on disk, a
warmed session also leaves the next session ready.

.. CG-EXPLANATION-END id=function:_compile_mesh_kernel

Module-level constants and statements
-------------------------------------

.. CG-BLOCK id=module-statements lines=100-108

.. literalinclude:: ../../../src/groundmodel/api/heavy_library_warmup.py
   :language: python
   :lines: 100-108
   :lineno-match:

.. CG-EXPLANATION-START id=module-statements

**What this does.** Lists the warm-up steps in order, each as a ``(label,
function)`` pair: numba, geolib, ezdxf, scipy, then the mesh-kernel compile.

**Why it is here.** Keeping the steps in one named list makes the run loop below
simple, gives each step a label for the log, and lets a test swap in cheap fake
steps instead of loading the real heavy libraries.

.. CG-EXPLANATION-END id=module-statements

Class ``HeavyLibraryWarmup`` — header
-------------------------------------

.. CG-BLOCK id=class:HeavyLibraryWarmup lines=109-117

.. literalinclude:: ../../../src/groundmodel/api/heavy_library_warmup.py
   :language: python
   :lines: 109-117
   :lineno-match:

.. CG-EXPLANATION-START id=class:HeavyLibraryWarmup

**What this does.** The object that runs the warm-up, either straight away or on
a background thread. It inherits the project's logger so it can report per-step
timings, a summary, and any failures.

**Why it is here.** Wrapping the warm-up in a class lets it carry the logging
behaviour the project's "definition of done" asks of any working component. The
methods below are: set up the logger, run the steps, and start the whole thing on
a background thread.

.. CG-EXPLANATION-END id=class:HeavyLibraryWarmup

Method ``HeavyLibraryWarmup``. ``def __init__``
-----------------------------------------------

.. CG-BLOCK id=method:HeavyLibraryWarmup.__init__ lines=118-121

.. literalinclude:: ../../../src/groundmodel/api/heavy_library_warmup.py
   :language: python
   :lines: 118-121
   :lineno-match:

.. CG-EXPLANATION-START id=method:HeavyLibraryWarmup.__init__

**What this does.** The set-up method — it just names the logger after this
module.

**Why it is here.** So every log line this object writes is tagged with the right
source, making the warm-up easy to find in a log file.

.. CG-EXPLANATION-END id=method:HeavyLibraryWarmup.__init__

Method ``HeavyLibraryWarmup``. ``def run``
------------------------------------------

.. CG-BLOCK id=method:HeavyLibraryWarmup.run lines=122-144

.. literalinclude:: ../../../src/groundmodel/api/heavy_library_warmup.py
   :language: python
   :lines: 122-144
   :lineno-match:

.. CG-EXPLANATION-START id=method:HeavyLibraryWarmup.run

**What this does.** Runs every warm-up step in order. It times each one; a
success writes a short debug line, a failure writes a warning with the error and
*carries on* to the next step. A one-line summary closes the run. It never
throws.

**Why it is here.** One broken or missing library must never stop the others from
warming, so each step is isolated. It never throws because it is the target of a
background thread — an escaping error there would simply be lost on a dead thread,
so it is caught and logged instead.

.. CG-EXPLANATION-END id=method:HeavyLibraryWarmup.run

Method ``HeavyLibraryWarmup``. ``def start_in_background``
----------------------------------------------------------

.. CG-BLOCK id=method:HeavyLibraryWarmup.start_in_background lines=145-166

.. literalinclude:: ../../../src/groundmodel/api/heavy_library_warmup.py
   :language: python
   :lines: 145-166
   :lineno-match:

.. CG-EXPLANATION-START id=method:HeavyLibraryWarmup.start_in_background

**What this does.** Starts ``run`` on a background thread — unless the skip switch
(``STRIXGEO_SKIP_WARMUP=1``) is set, in which case it logs that it skipped and
does nothing.

**Why it is here.** The thread is marked ``daemon=True``, meaning it will never
hold up the program from closing. The skip switch is what the test suite and the
end-to-end harness set, so a test backend does not spend effort importing numba
and friends it will never use.

.. CG-EXPLANATION-END id=method:HeavyLibraryWarmup.start_in_background

Function ``def warm_heavy_libraries``
-------------------------------------

.. CG-BLOCK id=function:warm_heavy_libraries lines=167-176

.. literalinclude:: ../../../src/groundmodel/api/heavy_library_warmup.py
   :language: python
   :lines: 167-176
   :lineno-match:

.. CG-EXPLANATION-START id=function:warm_heavy_libraries

**What this does.** Warms every library right now, on the calling thread, and
waits for it to finish.

**Why it is here.** This is the simple, blocking version — used by the background
thread as its target and by measurement and tests. For the real
"don't-block-anything" path at boot, callers use ``start_background_warmup``
below.

.. CG-EXPLANATION-END id=function:warm_heavy_libraries

Function ``def start_background_warmup``
----------------------------------------

.. CG-BLOCK id=function:start_background_warmup lines=177-188

.. literalinclude:: ../../../src/groundmodel/api/heavy_library_warmup.py
   :language: python
   :lines: 177-188
   :lineno-match:

.. CG-EXPLANATION-START id=function:start_background_warmup

**What this does.** The one line the start-up routine calls: start the warm-up on
a background thread (unless skipped).

**Why it is here.** It is called right after the "engine READY" log line, so
readiness is never delayed by the warm-up. It hands back the thread it started,
or nothing if the warm-up was skipped.

.. CG-EXPLANATION-END id=function:start_background_warmup

