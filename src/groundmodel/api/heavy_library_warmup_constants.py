"""Constants for the post-boot heavy-library warm-up.

Kept in a dedicated ``*_constants.py`` file (per the project convention that
module-level constants live beside — never inside — the class that uses them) so
the env-switch name and the thread name are importable and discoverable by both
:mod:`groundmodel.api.heavy_library_warmup` and its tests.
"""

from __future__ import annotations

# Env var that suppresses the background warm-up. Set to ``"1"`` by the unit /
# integration test suite (``tests/conftest.py``) and the Playwright e2e harness
# (``scripts/run-e2e.ps1``) so a test / e2e backend never spends CPU importing
# numba/geolib/ezdxf/scipy or JIT-compiling the mesh kernel in the background.
# Read exactly like ``STRIXGEO_DOV_FIXTURE_MODE`` (``os.environ.get(...) == "1"``).
WARMUP_SKIP_ENV = "STRIXGEO_SKIP_WARMUP"

# Name given to the background warm-up thread so it is identifiable in a thread
# dump / faulthandler trace (it holds per-module import locks while it runs).
WARMUP_THREAD_NAME = "strix-warmup"
