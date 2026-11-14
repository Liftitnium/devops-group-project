"""Logging to stdout as one JSON object per line.

Container Apps ships stdout to Log Analytics (table ContainerAppConsoleLogs_CL, column
Log_s), where parse_json(Log_s) turns each line back into fields. That is what the
dashboard and SLO queries in monitoring/queries.kql rely on.
"""

import json
import logging
import sys
from datetime import UTC, datetime

# fields the request middleware attaches with logging's `extra=`
REQUEST_FIELDS = ("method", "path", "status", "duration_ms")


class JsonFormatter(logging.Formatter):
    def __init__(self, service: str):
        super().__init__()
        self.service = service

    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "service": self.service,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for field in REQUEST_FIELDS:
            if hasattr(record, field):
                entry[field] = getattr(record, field)
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(entry)


def configure(service: str, level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter(service))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
