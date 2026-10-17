"""Custom logging levels: TRACE (5) and SUCCESS (25)."""

import logging

TRACE = 5
SUCCESS = 25
logging.addLevelName(TRACE, "TRACE")
logging.addLevelName(SUCCESS, "SUCCESS")
