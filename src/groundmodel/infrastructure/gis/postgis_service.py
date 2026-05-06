"""PostGIS spatial data service (stub — Phase 1)."""
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class PostGISService(GroundModelLogger):
    """Spatial query and storage service backed by PostGIS."""

    def __init__(self) -> None:
        super().__init__(__name__)
