"""Shared pytest configuration for the whole test tree.

Defaults the heavy-library warm-up OFF for every test run: importing the app
lifespan (e.g. ``with TestClient(app)``) would otherwise spawn the background
warm-up thread and import numba/geolib/ezdxf/scipy + JIT-compile the mesh kernel
during unrelated tests. ``setdefault`` leaves an explicit outer value (a test
that opts in, or CI) untouched, and the warm-up's own tests toggle the flag
themselves.
"""

import os

# Read exactly like ``STRIXGEO_DOV_FIXTURE_MODE`` (see
# ``groundmodel.api.heavy_library_warmup_constants.WARMUP_SKIP_ENV``).
os.environ.setdefault("STRIXGEO_SKIP_WARMUP", "1")
