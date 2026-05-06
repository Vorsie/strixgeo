import logging
from groundmodel.shared.logging.levels import TRACE, SUCCESS


class LoggerFactory:
    _handlers_configured = False

    @classmethod
    def get_logger(cls, name: str) -> logging.Logger:
        if not cls._handlers_configured:
            cls._configure()
        logger = logging.getLogger(name)
        cls._add_custom_methods(logger)
        return logger

    @classmethod
    def _configure(cls) -> None:
        logging.basicConfig(
            format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            level=TRACE,
        )
        cls._handlers_configured = True

    @staticmethod
    def _add_custom_methods(logger: logging.Logger) -> None:
        def trace(msg: str, *args: object, **kwargs: object) -> None:
            logger.log(TRACE, msg, *args, **kwargs)

        def success(msg: str, *args: object, **kwargs: object) -> None:
            logger.log(SUCCESS, msg, *args, **kwargs)

        logger.trace = trace  # type: ignore[attr-defined]
        logger.success = success  # type: ignore[attr-defined]
