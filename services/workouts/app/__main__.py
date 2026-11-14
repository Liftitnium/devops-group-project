"""python -m app: configure JSON logging to stdout and serve the API."""

import os

import uvicorn

from app import logs
from app.config import SERVICE_NAME, load_settings
from app.main import create_app


def main() -> None:
    logs.configure(SERVICE_NAME, os.environ.get("LOG_LEVEL", "INFO"))
    settings = load_settings()
    # the middleware logs every request, so uvicorn's own access log is off
    uvicorn.run(
        create_app(settings), host=settings.host, port=settings.port, access_log=False, log_config=None
    )


if __name__ == "__main__":
    main()
