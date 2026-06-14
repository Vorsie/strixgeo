"""Litho-3D solid-builder benchmarks — STUB pending Task 10 repoint.

The loft mesher (``build_loft_meshes`` / ``LoftField``) that this module
benchmarked has been RETIRED in Task 9.  The implicit stratigraphic builder
(``build_strat_model``) replaced it.

Task 10 will rewrite this module to benchmark ``build_strat_model`` on a
synthetic multi-column / multi-body control dataset.  Until then the module
is skipped at collection time so it does not block ``--collect-only`` or
normal test runs.

Baseline numbers for the old loft builder are preserved in CLAUDE.local.md
under "Litho-3D watertight LOFT builder (2026-06-13)".
"""

from __future__ import annotations

import pytest

# Skip every test in this module — the loft mesher it benchmarked was retired
# in Task 9.  Task 10 will rewrite the benchmarks for build_strat_model.
pytestmark = pytest.mark.skip(
    reason="Task 9: loft mesher retired; Task 10 rewrites for strat builder"
)
