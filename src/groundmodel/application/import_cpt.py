from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


async def import_cpt(file_path: str) -> None:
    ...
