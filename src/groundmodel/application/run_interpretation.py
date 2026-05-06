from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


async def run_cpt_interpretation(cpt_id: str) -> None:
    ...
