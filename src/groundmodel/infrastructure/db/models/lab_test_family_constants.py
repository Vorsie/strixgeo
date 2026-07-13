"""Registry of the six sample lab-test families (single source of truth).

Every place that enumerates the lab-test child collections of
``SampleOrm`` — bundle serialisation, bundle restore, project
duplication, the borehole eager-load chain — derives from this
registry instead of hand-listing the six families. Adding a seventh
typed family means: create its ORM + relationship on ``SampleOrm``,
append ONE entry here, and add the (necessarily static) Pydantic
response field — instead of editing seven files.

Each entry pairs the ``SampleOrm`` relationship name (which doubles as
the bundle JSON key — the two have always been identical) with the leaf
ORM class. Order is the canonical display order; it is also the bundle
key order, so reordering entries would reorder bundle JSON keys.

The leaf ORM modules only import ``Base`` (relationships are declared
by string name), so importing them here creates no cycle.
"""

from groundmodel.infrastructure.db.models.atterberg_limits_orm import AtterbergLimitsOrm
from groundmodel.infrastructure.db.models.caco3_content_orm import CaCO3ContentOrm
from groundmodel.infrastructure.db.models.grain_size_orm import GrainSizeOrm
from groundmodel.infrastructure.db.models.organic_content_orm import OrganicContentOrm
from groundmodel.infrastructure.db.models.scalar_lab_test_orm import ScalarLabTestOrm
from groundmodel.infrastructure.db.models.water_content_orm import WaterContentOrm

# (relationship name on SampleOrm == bundle JSON key, leaf ORM class).
LAB_TEST_FAMILIES: tuple[tuple[str, type], ...] = (
    ("grain_sizes", GrainSizeOrm),
    ("atterberg_limits_tests", AtterbergLimitsOrm),
    ("caco3_content_tests", CaCO3ContentOrm),
    ("organic_content_tests", OrganicContentOrm),
    ("water_content_tests", WaterContentOrm),
    ("scalar_lab_tests", ScalarLabTestOrm),
)

# Names-only view for consumers that never touch the ORM classes
# (eager-load chains, clone loops, include-set validation).
LAB_TEST_RELATIONSHIP_NAMES: tuple[str, ...] = tuple(name for name, _ in LAB_TEST_FAMILIES)
