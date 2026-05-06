"""PostGIS spatial data service (stub — Phase 1)."""
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


class PostGISService:
    """Spatial query and storage service backed by PostGIS."""
