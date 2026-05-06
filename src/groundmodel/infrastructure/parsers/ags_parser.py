from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


class AGSParser:
    def parse(self, content: str) -> list:
        ...
