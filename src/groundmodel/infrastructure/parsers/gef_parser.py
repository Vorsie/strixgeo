from groundmodel.domain.models.pushed.cpt import CPT
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


class GEFParser:
    def parse(self, content: str) -> CPT:
        ...
