"""Boot-path import discipline test for the FastAPI application.

Guards the rule that importing the API must not import the export/compute
libraries — they load on first use. The heavy scientific / export stacks
(numba + llvmlite for the voxel mesh JIT, geolib for the D-Series exporters,
ezdxf for the DXF exporters, matplotlib/scipy for plotting and interpolation)
cost most of the packaged cold-start budget because their import time scales
with the number of files read off disk (Defender-scanned on first touch).
None of them is needed to answer ``/openapi.json`` or to register the routers,
so a boot that pulls them in is a regression against packaged start-up time
(owner report, installer #12: "starting the api takes a minute").
"""

from __future__ import annotations

import subprocess
import sys

# Packages that MUST NOT be imported merely by importing the API entry point.
# Each is needed only when a specific feature runs (an export, a voxel build, a
# TIN surface, a plot), never at boot or router registration.
# pymupdf / cv2: the PDF CPT digitiser loads them on the first report opened.
_FORBIDDEN_AT_BOOT = (
    "numba",
    "llvmlite",
    "geolib",
    "ezdxf",
    "matplotlib",
    "scipy",
    "pymupdf",
    "cv2",
)


def test_boot_does_not_import_export_or_compute_libraries() -> None:
    """Importing ``groundmodel.api.main`` must leave the heavy libs unloaded.

    Runs in a fresh interpreter (a subprocess) so the assertion sees only what
    ``import groundmodel.api.main`` itself pulled in — the parent pytest process
    has already imported half the world, which would mask the regression. The
    subprocess imports the API entry point and prints the sorted list of
    forbidden packages that ended up in ``sys.modules``; a lazy boot prints
    ``[]``.

    Notes
    -----
    The test comment, in the rule's own words: importing the API must not import
    the export/compute libraries — they load on first use.
    """
    forbidden_tuple = repr(_FORBIDDEN_AT_BOOT)
    probe = (
        "import sys, groundmodel.api.main; "
        f"print(sorted(m for m in {forbidden_tuple} if m in sys.modules))"
    )
    completed = subprocess.run(
        [sys.executable, "-c", probe],
        capture_output=True,
        text=True,
        check=True,
    )
    printed = completed.stdout.strip().splitlines()[-1] if completed.stdout.strip() else ""
    assert printed == "[]", (
        "Importing the API pulled in heavy export/compute libraries that must "
        f"be deferred to first use. Boot imported: {printed}\n"
        f"subprocess stderr:\n{completed.stderr}"
    )
