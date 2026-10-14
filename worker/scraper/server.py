"""Tiny internal HTTP front for the vendored contact scraper.

Only the lookup wrapper talks to this (over a private Docker network). Every request needs the
shared secret header. One scrape runs at a time per slot; extra callers get 429 instead of queueing,
because a Chrome-backed crawl is heavy.
"""
import hmac
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET = os.environ.get("SCRAPER_SECRET", "")
if len(SECRET) < 32:
    print("SCRAPER_SECRET missing or shorter than 32 characters; refusing to start", file=sys.stderr)
    sys.exit(1)

MAX_CONCURRENT = max(1, int(os.environ.get("SCRAPER_MAX_CONCURRENT", "2")))
SLOTS = threading.BoundedSemaphore(MAX_CONCURRENT)
MODES = {"homepage", "key_pages", "deep"}
MAX_BODY = 4096


def authorised(handler):
    provided = handler.headers.get("x-scraper-secret", "")
    return hmac.compare_digest(provided.encode(), SECRET.encode())


class Handler(BaseHTTPRequestHandler):
    server_version = "scraper"
    sys_version = ""

    def log_message(self, fmt, *args):  # keep logs short, never log request bodies
        print("scraper:", fmt % args, file=sys.stderr)

    def _send(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not authorised(self):
            return self._send(401, {"error": "unauthorized"})
        if self.path == "/health":
            return self._send(200, {"ok": True})
        return self._send(404, {"error": "not_found"})

    def do_POST(self):
        if not authorised(self):
            return self._send(401, {"error": "unauthorized"})
        if self.path != "/scrape":
            return self._send(404, {"error": "not_found"})
        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > MAX_BODY:
                return self._send(400, {"error": "bad_request"})
            data = json.loads(self.rfile.read(length))
            url = data.get("url")
            mode = data.get("mode", "key_pages")
            if not isinstance(url, str) or not url or len(url) > 2000 or mode not in MODES:
                return self._send(400, {"error": "bad_request"})
        except Exception:
            return self._send(400, {"error": "bad_request"})

        if not SLOTS.acquire(blocking=False):
            return self._send(429, {"error": "busy"})
        try:
            from contact_scraper.api import scrape_contacts  # lazy: only this path needs Chrome/patchright

            result = scrape_contacts({"query": url, "mode": mode})
            return self._send(200, result)
        except Exception as exc:  # never leak internals
            print("scraper: crawl failed:", type(exc).__name__, file=sys.stderr)
            return self._send(500, {"error": "scrape_failed"})
        finally:
            SLOTS.release()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"scraper listening on :{port} (max {MAX_CONCURRENT} concurrent)", file=sys.stderr)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
