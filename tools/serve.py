# Local dev server that disables caching, so edits show up on reload.
# Usage: python tools/serve.py [port]
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
