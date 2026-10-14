"""Small stand-ins for the three `botasaurus` helpers the original project imported.

The vendored scraper only used botasaurus for Docker detection, an OS name and an
error logger. Replacing them here lets us drop `botasaurus` and `botasaurus-server`
(and the third-party base image that shipped them) entirely.
"""
import os
import platform
import sys

IS_DOCKER = os.path.exists("/.dockerenv") or os.environ.get("IS_DOCKER", "").lower() == "true"
IS_IN_KUBERNETES = bool(os.environ.get("KUBERNETES_SERVICE_HOST"))


def get_os():
    return {"Linux": "linux", "Darwin": "mac", "Windows": "windows"}.get(platform.system(), "linux")


def save_error_logs(error, driver=None):
    """Original wrote a screenshot plus text. We only log text to stderr (patchright drivers passed None anyway)."""
    print(str(error), file=sys.stderr)
