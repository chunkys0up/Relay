from __future__ import annotations

import logging
import logging.handlers
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parents[2] / "logs"
LOG_FILE = LOG_DIR / "relay.log"
_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


def setup_logging(level: str = "INFO") -> None:
    """Log the app's own events (logger namespace 'relay') to console and logs/relay.log.

    Log IDs, roles, statuses, timings and error codes only. Never log tokens,
    join configs, document text, chat text or presigned URLs.
    """
    LOG_DIR.mkdir(exist_ok=True)
    logger = logging.getLogger("relay")
    if logger.handlers:  # already configured (reload / repeated import)
        return
    logger.setLevel(level.upper())
    formatter = logging.Formatter(_FORMAT)
    file_handler = logging.handlers.RotatingFileHandler(
        LOG_FILE, maxBytes=2_000_000, backupCount=2, encoding="utf-8"
    )
    console = logging.StreamHandler()
    for handler in (file_handler, console):
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    logger.propagate = False
